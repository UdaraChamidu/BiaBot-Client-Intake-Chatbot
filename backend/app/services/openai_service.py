"""LLM utility for optional intake summary polishing."""

import json
import re
from typing import Any

import httpx

from app.core.config import get_settings

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


class OpenAIService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.provider = (self.settings.ai_provider or "openai").strip().lower()
        self.client = None

        if self.provider in {"none", "off", "disabled"}:
            return

        if self.provider in {"openai", "openai_compatible"} and OpenAI:
            api_key = self.settings.ai_api_key or self.settings.openai_api_key
            base_url = self.settings.ai_base_url or self.settings.openai_base_url
            if not api_key:
                return

            kwargs: dict[str, Any] = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            self.client = OpenAI(**kwargs)

    def _openai_chat_completion(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> str | None:
        if not self.client:
            return None
        model = self.settings.ai_model or self.settings.openai_model
        completion = self.client.chat.completions.create(
            model=model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        text = completion.choices[0].message.content
        return text.strip() if text else None

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
        if confidence < 0:
            return 0.0
        if confidence > 1:
            return 1.0
        return confidence

    def _extract_required_tokens(self, fallback: str) -> list[str]:
        required_tokens: list[str] = []
        for token in ["Submit", "Restart", "Start New Request", "Yes", "No", "READYONE01"]:
            if re.search(re.escape(token), fallback, re.IGNORECASE):
                required_tokens.append(token)
        return required_tokens

    def _anthropic_completion(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> str | None:
        api_key = self.settings.anthropic_api_key or self.settings.ai_api_key
        model = self.settings.ai_model or self.settings.anthropic_model
        if not api_key:
            return None

        response = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 400,
                "temperature": temperature,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
            timeout=30.0,
        )
        response.raise_for_status()
        data = response.json()
        content = data.get("content", [])
        if not content:
            return None
        text = content[0].get("text", "")
        return text.strip() if text else None

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

        if self.provider in {"none", "off", "disabled"}:
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

        try:
            if self.provider in {"openai", "openai_compatible"}:
                rewritten = self._openai_chat_completion(
                    system_prompt=system_prompt,
                    user_prompt=prompt,
                    temperature=0.35,
                )
                return rewritten or fallback

            if self.provider in {"anthropic", "claude"}:
                rewritten = self._anthropic_completion(
                    system_prompt=system_prompt,
                    user_prompt=prompt,
                    temperature=0.35,
                )
                return rewritten or fallback

            return fallback
        except Exception:
            return fallback

    def generate_chat_reply(
        self,
        *,
        fallback: str,
        phase: str,
        context: dict[str, Any],
    ) -> str | None:
        if self.provider in {"none", "off", "disabled"}:
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
            "5) If the fallback asks a direct question, keep it a clear question.\n\n"
            "6) If context.retry_count is greater than 0, vary the phrasing and do not repeat previous wording.\n\n"
            + json.dumps(payload)
        )
        system_prompt = (
            "You are BiaBot, a conversational intake assistant. "
            "Write clear, professional, human-sounding responses."
        )

        try:
            text: str | None = None
            if self.provider in {"openai", "openai_compatible"}:
                text = self._openai_chat_completion(
                    system_prompt=system_prompt,
                    user_prompt=prompt,
                    temperature=0.35,
                )
            elif self.provider in {"anthropic", "claude"}:
                text = self._anthropic_completion(
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
        except Exception:
            return None

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
        if self.provider in {"none", "off", "disabled"}:
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
            "Extract the user's answer for the target question. "
            "Return strict JSON only with this schema: "
            '{"ok":bool,"value":string|array|null,"confidence":0..1,'
            '"needs_clarification":bool,"clarification_question":string|null,"reason":string}. '
            "Rules: If question type is date, output ISO date YYYY-MM-DD when possible. "
            "If options are provided, value must exactly match one option. "
            "If answer is ambiguous, set needs_clarification=true and ask one focused question."
            "\n\n"
            + json.dumps(prompt_payload)
        )
        system_prompt = (
            "You are an information extraction model for an intake chatbot. "
            "Be conservative and do not invent values."
        )

        try:
            text: str | None = None
            if self.provider in {"openai", "openai_compatible"}:
                text = self._openai_chat_completion(
                    system_prompt=system_prompt,
                    user_prompt=prompt,
                    temperature=0.0,
                )
            elif self.provider in {"anthropic", "claude"}:
                text = self._anthropic_completion(
                    system_prompt=system_prompt,
                    user_prompt=prompt,
                    temperature=0.0,
                )

            if not text:
                return None

            parsed = self._extract_json_object(text)
            if not parsed:
                return None

            return {
                "ok": bool(parsed.get("ok")),
                "value": parsed.get("value"),
                "confidence": self._coerce_confidence(parsed.get("confidence"), default=0.0),
                "needs_clarification": bool(parsed.get("needs_clarification", False)),
                "clarification_question": parsed.get("clarification_question"),
                "reason": str(parsed.get("reason", "")),
            }
        except Exception:
            return None

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
        if self.provider in {"none", "off", "disabled"}:
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
            "4) For choice questions, naturally include the options in-line.\n"
            "5) If optional, mention it is optional.\n\n"
            + json.dumps(payload)
        )
        system_prompt = (
            "You are BiaBot, a professional and friendly intake assistant. "
            "You ask one clear question at a time to collect structured project intake details."
        )

        try:
            text: str | None = None
            if self.provider in {"openai", "openai_compatible"}:
                text = self._openai_chat_completion(
                    system_prompt=system_prompt,
                    user_prompt=prompt,
                    temperature=0.3,
                )
            elif self.provider in {"anthropic", "claude"}:
                text = self._anthropic_completion(
                    system_prompt=system_prompt,
                    user_prompt=prompt,
                    temperature=0.3,
                )

            cleaned = (text or "").strip()
            return cleaned or None
        except Exception:
            return None

    def summarize_intake(
        self,
        client_profile: dict[str, Any],
        intake_payload: dict[str, Any],
        fallback_summary: str,
    ) -> str:
        if self.provider in {"none", "off", "disabled"}:
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

        try:
            if self.provider in {"openai", "openai_compatible"}:
                text = self._openai_chat_completion(
                    system_prompt=self.settings.intake_system_prompt,
                    user_prompt=prompt,
                    temperature=0.2,
                )
                return text.strip() if text else fallback_summary

            if self.provider in {"anthropic", "claude"}:
                text = self._anthropic_completion(
                    system_prompt=self.settings.intake_system_prompt,
                    user_prompt=prompt,
                    temperature=0.2,
                )
                return text.strip() if text else fallback_summary

            return fallback_summary
        except Exception:
            return fallback_summary
