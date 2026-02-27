"""OpenAI utility for chat generation, extraction, and summary."""

from __future__ import annotations

import json
import re
from typing import Any

from app.core.config import get_settings

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


class OpenAIService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = None
        if OpenAI is None:
            return

        api_key = (self.settings.openai_api_key or "").strip()
        if not api_key:
            return

        kwargs: dict[str, Any] = {"api_key": api_key}
        if self.settings.openai_base_url:
            kwargs["base_url"] = self.settings.openai_base_url
        self.client = OpenAI(**kwargs)

    @property
    def available(self) -> bool:
        return self.client is not None

    def _chat_completion(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> str | None:
        if not self.client:
            return None

        try:
            completion = self.client.chat.completions.create(
                model=self.settings.openai_model,
                temperature=temperature,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            text = completion.choices[0].message.content
            return text.strip() if text else None
        except Exception:
            return None

    def _extract_json_object(self, text: str) -> dict[str, Any] | None:
        if not text:
            return None
        raw = text.strip()

        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            pass

        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            return None
        candidate = match.group(0)
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None

    def _coerce_confidence(self, value: Any, default: float = 0.0) -> float:
        try:
            confidence = float(value)
        except Exception:
            return default
        return max(0.0, min(1.0, confidence))

    def _extract_required_tokens(self, fallback: str) -> list[str]:
        required_tokens: list[str] = []
        for token in ["Submit", "Restart", "Start New Request", "Yes", "No"]:
            if re.search(re.escape(token), fallback, re.IGNORECASE):
                required_tokens.append(token)
        return required_tokens

    def refine_chat_reply(
        self,
        *,
        fallback: str,
        phase: str,
        context: dict[str, Any],
    ) -> str:
        if self.settings.chat_use_llm_response_generation:
            generated = self.generate_chat_reply(
                fallback=fallback,
                phase=phase,
                context=context,
            )
            return generated or fallback

        if not self.settings.chat_use_llm_rewrite:
            return fallback

        prompt = (
            "Rewrite the assistant message to sound warm, concise, and human. "
            "Keep intent and facts exactly. Do not add new requirements. "
            "Return plain text only.\n\n"
            + json.dumps({"phase": phase, "context": context, "message": fallback})
        )
        system_prompt = (
            "You are BiaBot, a professional intake assistant. "
            "Respond with one clear assistant message, friendly but concise."
        )
        rewritten = self._chat_completion(
            system_prompt=system_prompt,
            user_prompt=prompt,
            temperature=0.35,
        )
        return rewritten or fallback

    def generate_chat_reply(
        self,
        *,
        fallback: str,
        phase: str,
        context: dict[str, Any],
    ) -> str | None:
        if not self.available:
            return None

        required_tokens = self._extract_required_tokens(fallback)
        payload = {
            "phase": phase,
            "context": context,
            "intent_fallback": fallback,
            "required_tokens": required_tokens,
        }
        prompt = (
            "Generate the assistant's next message for an intake chatbot.\n"
            "Output plain text only.\n"
            "Rules:\n"
            "1) Keep the exact intent and factual meaning of intent_fallback.\n"
            "2) Make it natural, concise, and human.\n"
            "3) Keep intake scope only (no unrelated advice).\n"
            "4) If required_tokens is non-empty, include each token exactly as written.\n"
            "5) If the fallback asks a direct question, keep it a clear question.\n"
            "6) If context.retry_count is greater than 0, vary phrasing.\n\n"
            + json.dumps(payload)
        )
        system_prompt = (
            "You are BiaBot, a conversational intake assistant. "
            "Write clear, professional, human-sounding responses."
        )
        text = self._chat_completion(
            system_prompt=system_prompt,
            user_prompt=prompt,
            temperature=0.35,
        )
        cleaned = (text or "").strip()
        if not cleaned:
            return None

        lowered = cleaned.lower()
        for token in required_tokens:
            if token.lower() not in lowered:
                return None
        return cleaned

    def interpret_preauth_message(
        self,
        *,
        message: str,
        known_user_name: str | None = None,
    ) -> dict[str, Any] | None:
        if not self.available:
            return None

        payload = {
            "task": "interpret_preauth_message",
            "known_user_name": known_user_name,
            "user_message": message,
        }
        prompt = (
            "Interpret this pre-auth user message for an intake chatbot.\n"
            "Return strict JSON only with schema:\n"
            '{"intent":"submit_client_code|ask_client_code_info|greeting|identity|share_name|smalltalk|other",'
            '"client_code":string|null,"user_name":string|null,"assistant_reply":string,"confidence":0..1}\n'
            "Rules:\n"
            "1) If a client code is provided or strongly implied, set intent=submit_client_code.\n"
            "2) If user asks what client code means or where to find it, use ask_client_code_info.\n"
            "3) assistant_reply must be friendly and ask for client code to continue intake.\n"
            "4) Keep assistant_reply within intake scope.\n\n"
            + json.dumps(payload)
        )
        system_prompt = (
            "You are a strict intent classifier and response planner for a client-intake chatbot."
        )
        text = self._chat_completion(
            system_prompt=system_prompt,
            user_prompt=prompt,
            temperature=0.1,
        )
        parsed = self._extract_json_object(text or "")
        if not parsed:
            return None

        intent = str(parsed.get("intent", "other")).strip().lower()
        allowed_intents = {
            "submit_client_code",
            "ask_client_code_info",
            "greeting",
            "identity",
            "share_name",
            "smalltalk",
            "other",
        }
        if intent not in allowed_intents:
            intent = "other"

        client_code = parsed.get("client_code")
        if isinstance(client_code, str):
            client_code = client_code.strip().upper()
            if not re.fullmatch(r"[A-Z0-9_-]{3,64}", client_code):
                client_code = None
        else:
            client_code = None

        user_name = parsed.get("user_name")
        if isinstance(user_name, str):
            user_name = user_name.strip()
            if not re.fullmatch(r"[A-Za-z][A-Za-z\-']{1,40}", user_name):
                user_name = None
            elif len(user_name) >= 2:
                user_name = user_name[0].upper() + user_name[1:]
        else:
            user_name = None

        assistant_reply = str(parsed.get("assistant_reply", "")).strip()
        if not assistant_reply:
            assistant_reply = None

        return {
            "intent": intent,
            "client_code": client_code,
            "user_name": user_name,
            "assistant_reply": assistant_reply,
            "confidence": self._coerce_confidence(parsed.get("confidence"), default=0.0),
        }

    def classify_control_action(
        self,
        *,
        phase: str,
        user_message: str,
        allowed_actions: list[str],
    ) -> dict[str, Any] | None:
        if not self.available:
            return None
        if not allowed_actions:
            return None

        normalized_actions = [action.strip().lower() for action in allowed_actions if action.strip()]
        payload = {
            "task": "classify_control_action",
            "phase": phase,
            "user_message": user_message,
            "allowed_actions": normalized_actions,
        }
        prompt = (
            "Classify the user control action.\n"
            "Return strict JSON only with schema:\n"
            '{"action":string,"confidence":0..1}\n'
            "Rules:\n"
            "1) action must be one of allowed_actions or 'other'.\n"
            "2) Be conservative.\n\n"
            + json.dumps(payload)
        )
        system_prompt = "You are a strict intent classifier."
        text = self._chat_completion(
            system_prompt=system_prompt,
            user_prompt=prompt,
            temperature=0.0,
        )
        parsed = self._extract_json_object(text or "")
        if not parsed:
            return None

        action = str(parsed.get("action", "other")).strip().lower()
        if action not in normalized_actions:
            action = "other"
        return {
            "action": action,
            "confidence": self._coerce_confidence(parsed.get("confidence"), default=0.0),
        }

    def generate_redirect_reply(
        self,
        *,
        user_message: str,
        question_label: str,
        question_options: list[str] | None = None,
    ) -> str | None:
        if not self.available:
            return None

        payload = {
            "task": "answer_and_redirect",
            "user_message": user_message,
            "question_label": question_label,
            "question_options": question_options or [],
        }
        prompt = (
            "Write one assistant reply.\n"
            "1) Briefly answer the user's side question if possible.\n"
            "2) Politely redirect to the current intake question.\n"
            "3) Keep to intake context and be concise.\n"
            "Return plain text only.\n\n"
            + json.dumps(payload)
        )
        system_prompt = (
            "You are BiaBot, a conversational intake assistant that stays on track."
        )
        text = self._chat_completion(
            system_prompt=system_prompt,
            user_prompt=prompt,
            temperature=0.35,
        )
        cleaned = (text or "").strip()
        return cleaned or None

    def extract_structured_answer(
        self,
        *,
        question_id: str,
        question_label: str,
        question_type: str,
        required: bool,
        options: list[str],
        user_message: str,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if not self.available:
            return None

        prompt_payload = {
            "task": "extract_answer",
            "question": {
                "id": question_id,
                "label": question_label,
                "type": question_type,
                "required": required,
                "options": options,
            },
            "user_message": user_message,
            "context": context or {},
        }
        prompt = (
            "Extract the user's answer for the target question.\n"
            "Return strict JSON only with this schema:\n"
            '{"ok":bool,"value":string|array|null,"confidence":0..1,'
            '"needs_clarification":bool,"clarification_question":string|null,'
            '"off_topic":bool,"assistant_reply":string|null,"reason":string}\n'
            "Rules:\n"
            "1) If question type is date, output ISO date YYYY-MM-DD when possible.\n"
            "2) If options are provided, value must exactly match one option.\n"
            "3) If answer is ambiguous, set needs_clarification=true with one focused question.\n"
            "4) If user message is off-topic for the target field, set off_topic=true and provide assistant_reply "
            "that briefly responds then asks for the target field.\n\n"
            + json.dumps(prompt_payload)
        )
        system_prompt = (
            "You are an information extraction model for an intake chatbot. "
            "Be conservative and do not invent values."
        )
        text = self._chat_completion(
            system_prompt=system_prompt,
            user_prompt=prompt,
            temperature=0.0,
        )
        parsed = self._extract_json_object(text or "")
        if not parsed:
            return None

        assistant_reply = parsed.get("assistant_reply")
        if isinstance(assistant_reply, str):
            assistant_reply = assistant_reply.strip() or None
        else:
            assistant_reply = None

        return {
            "ok": bool(parsed.get("ok")),
            "value": parsed.get("value"),
            "confidence": self._coerce_confidence(parsed.get("confidence"), default=0.0),
            "needs_clarification": bool(parsed.get("needs_clarification", False)),
            "clarification_question": parsed.get("clarification_question"),
            "off_topic": bool(parsed.get("off_topic", False)),
            "assistant_reply": assistant_reply,
            "reason": str(parsed.get("reason", "")),
        }

    def generate_intake_question(
        self,
        *,
        service_type: str,
        question_id: str,
        question_label: str,
        question_type: str,
        required: bool,
        options: list[str],
        known_answers: dict[str, Any],
        remaining_question_labels: list[str],
    ) -> str | None:
        if not self.available:
            return None
        if not self.settings.chat_use_llm_question_generation:
            return None

        payload = {
            "task": "generate_next_intake_question",
            "service_type": service_type,
            "target_question": {
                "id": question_id,
                "label": question_label,
                "type": question_type,
                "required": required,
                "options": options,
            },
            "known_answers": known_answers,
            "remaining_questions": remaining_question_labels,
        }
        prompt = (
            "Generate the assistant's next question for an intake conversation.\n"
            "Output plain text only.\n"
            "Rules:\n"
            "1) Ask exactly one question targeting only the target field.\n"
            "2) Sound human and concise (one sentence, max two).\n"
            "3) Do not expose internal IDs, schemas, or validation rules.\n"
            "4) For choice questions, naturally include options in-line.\n"
            "5) If optional, mention it is optional.\n\n"
            + json.dumps(payload)
        )
        system_prompt = (
            "You are BiaBot, a professional and friendly intake assistant. "
            "You ask one clear question at a time to collect structured project intake details."
        )
        text = self._chat_completion(
            system_prompt=system_prompt,
            user_prompt=prompt,
            temperature=0.3,
        )
        cleaned = (text or "").strip()
        return cleaned or None

    def summarize_intake(
        self,
        client_profile: dict[str, Any],
        intake_payload: dict[str, Any],
        fallback_summary: str,
    ) -> str:
        if not self.available:
            return fallback_summary

        user_payload = {
            "client_profile": {
                "client_name": client_profile.get("client_name"),
                "preferred_tone": client_profile.get("preferred_tone"),
                "required_disclaimers": client_profile.get("required_disclaimers"),
            },
            "request": intake_payload,
        }
        prompt = (
            "Convert this intake JSON into a concise contractor-ready summary. "
            "No deliverable drafting and no strategic advice.\n\n"
            + json.dumps(user_payload)
        )
        text = self._chat_completion(
            system_prompt=self.settings.intake_system_prompt,
            user_prompt=prompt,
            temperature=0.2,
        )
        return text.strip() if text else fallback_summary
