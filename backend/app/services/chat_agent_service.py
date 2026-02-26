"""Session-based conversational intake agent."""

from __future__ import annotations

import re
from datetime import datetime
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from app.models.schemas import ChatMessageResponse, IntakeQuestion, IntakeSubmission
from app.services.chat_parser import extract_client_code_candidates, match_option, normalize_answer
from app.services.flow_definitions import BRANCH_QUESTIONS, CORE_QUESTIONS
from app.services.intake_service import generate_summary
from app.services.monday_service import MondayService
from app.services.openai_service import OpenAIService
from app.services.store import InMemoryStore, SupabaseStore

SUBMIT_PATTERN = re.compile(r"\b(yes|y|submit|confirm|ok|okay|send|go ahead)\b", re.IGNORECASE)
RESTART_PATTERN = re.compile(
    r"\b(restart|start over|reset|edit|change|new request|another request)\b",
    re.IGNORECASE,
)
HELP_PATTERN = re.compile(r"\b(help|what can you do|how does this work)\b", re.IGNORECASE)
GREETING_PATTERN = re.compile(
    r"\b(hi|hello|hey|good morning|good afternoon|good evening|yo|hiya)\b",
    re.IGNORECASE,
)
IDENTITY_PATTERN = re.compile(
    r"\b(who are you|what are you|what is this|what can you do|how do you work)\b",
    re.IGNORECASE,
)
NAME_PATTERN = re.compile(
    r"\b(?:my name is|i am|i'm|this is|its)\s+([A-Za-z][A-Za-z\-']{1,40})\b",
    re.IGNORECASE,
)
CONFIRM_PATTERN = re.compile(r"^(yes|y|correct|right|exactly|that works|looks good)$", re.IGNORECASE)
REJECT_PATTERN = re.compile(r"^(no|n|not that|wrong|change it)$", re.IGNORECASE)

RULE_ACCEPT_CONFIDENCE = 0.86
LLM_ACCEPT_CONFIDENCE = 0.78
CLARIFY_CONFIDENCE = 0.55

CORE_FIELDS = {
    "project_title",
    "goal",
    "target_audience",
    "primary_cta",
    "time_sensitivity",
    "due_date",
    "approver",
    "required_elements",
    "references",
    "uploaded_files",
    "notes",
}


@dataclass
class ChatSession:
    session_id: str
    phase: str = "await_client_code"
    client_profile: dict[str, Any] | None = None
    service_type: str | None = None
    questions: list[IntakeQuestion] = field(default_factory=list)
    question_index: int = 0
    answers: dict[str, Any] = field(default_factory=dict)
    summary: str | None = None
    pending_field_id: str | None = None
    pending_value: Any = None
    pending_confidence: float = 0.0
    pending_question: str | None = None
    turn_count: int = 0
    last_user_message: str = ""
    client_code_attempts: int = 0
    service_attempts: int = 0
    user_name: str | None = None


class ChatAgentService:
    def __init__(
        self,
        *,
        store: InMemoryStore | SupabaseStore,
        openai_service: OpenAIService,
        monday_service: MondayService,
    ) -> None:
        self.store = store
        self.openai_service = openai_service
        self.monday_service = monday_service
        self.sessions: dict[str, ChatSession] = {}

    def process_message(
        self,
        *,
        message: str,
        session_id: str | None = None,
        reset: bool = False,
    ) -> ChatMessageResponse:
        session = self._get_or_create_session(session_id=session_id, reset=reset)
        cleaned = message.strip()
        session.turn_count += 1
        session.last_user_message = cleaned

        if reset:
            return self._response(
                session,
                self._assistant_text(
                    fallback=(
                        "New chat started. Please share your client code to begin, "
                        "for example READYONE01."
                    ),
                    phase=session.phase,
                    context={"event": "reset_chat", "retry_count": 0},
                ),
            )

        if not cleaned:
            fallback = self._welcome_fallback(session)
            return self._response(
                session,
                self._assistant_text(
                    fallback=fallback,
                    phase=session.phase,
                    context={
                        "event": "welcome",
                        "retry_count": max(session.turn_count - 1, 0),
                    },
                ),
            )

        if HELP_PATTERN.search(cleaned):
            help_fallback = (
                "I can verify your client code, collect your intake details in natural language, "
                "summarize everything, and submit it to Monday."
            )
            if session.phase == "await_client_code":
                help_fallback += " Please share your client code to get started."
            return self._response(
                session,
                self._assistant_text(
                    fallback=help_fallback,
                    phase=session.phase,
                    context={"event": "help", "retry_count": session.client_code_attempts},
                ),
                suggestions=self._phase_suggestions(session),
            )

        if session.phase == "await_client_code":
            return self._handle_client_code(session, cleaned)
        if session.phase == "await_service":
            return self._handle_service_selection(session, cleaned)
        if session.phase == "await_question":
            return self._handle_question_response(session, cleaned)
        if session.phase == "await_confirmation":
            return self._handle_confirmation(session, cleaned)
        if session.phase == "done":
            return self._handle_done(session, cleaned)

        session.phase = "await_client_code"
        return self._response(
            session,
            self._assistant_text(
                fallback="I reset the chat state. Please share your client code to continue.",
                phase=session.phase,
            ),
        )

    def _get_or_create_session(self, *, session_id: str | None, reset: bool) -> ChatSession:
        if session_id and not reset and session_id in self.sessions:
            return self.sessions[session_id]

        new_id = session_id if session_id and reset else str(uuid4())
        session = ChatSession(session_id=new_id)
        self.sessions[new_id] = session
        return session

    def _handle_client_code(self, session: ChatSession, message: str) -> ChatMessageResponse:
        extracted_candidates = extract_client_code_candidates(message)
        candidates = [message]
        candidates.extend(extracted_candidates)

        preauth_response = self._try_handle_pre_auth_dialog(
            session=session,
            message=message,
            extracted_candidates=extracted_candidates,
        )
        if preauth_response is not None:
            return preauth_response

        seen: set[str] = set()
        for candidate in candidates:
            normalized = candidate.strip().upper()
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            profile = self.store.get_client_profile(normalized)
            if not profile:
                continue

            session.client_profile = profile
            session.phase = "await_service"
            session.answers = {"approver": profile.get("default_approver") or ""}
            session.client_code_attempts = 0
            session.service_attempts = 0

            service_options = self._service_options(profile)
            return self._response(
                session,
                self._assistant_text(
                    fallback=(
                        f"Welcome back, {profile['client_name']}. "
                        "What kind of support do you need today?"
                    ),
                    phase=session.phase,
                    context={
                        "event": "client_code_verified",
                        "client_name": profile.get("client_name"),
                        "service_options": service_options,
                        "retry_count": 0,
                    },
                ),
                suggestions=service_options,
                profile=profile,
            )

        session.client_code_attempts += 1
        fallback = self._client_code_retry_fallback(session, message, candidates)
        return self._response(
            session,
            self._assistant_text(
                fallback=fallback,
                phase=session.phase,
                context={
                    "event": "client_code_retry",
                    "retry_count": session.client_code_attempts,
                    "user_message": message,
                    "candidate_codes": candidates[:4],
                },
            ),
        )

    def _handle_service_selection(self, session: ChatSession, message: str) -> ChatMessageResponse:
        profile = session.client_profile
        if not profile:
            session.phase = "await_client_code"
            return self._response(
                session,
                self._assistant_text(
                    fallback="I need your client code first. Please share it to continue.",
                    phase=session.phase,
                ),
            )

        options = self._service_options(profile)
        if session.pending_field_id == "service_type":
            confirmation_text = message.strip()
            if CONFIRM_PATTERN.search(confirmation_text) and isinstance(session.pending_value, str):
                selected_service = session.pending_value
                self._clear_pending_clarification(session)
                return self._activate_service_type(
                    session=session,
                    profile=profile,
                    selected=selected_service,
                    options=options,
                )
            if REJECT_PATTERN.search(confirmation_text):
                self._clear_pending_clarification(session)
                return self._response(
                    session,
                    self._assistant_text(
                        fallback=self._service_retry_fallback(session, options),
                        phase=session.phase,
                        context={
                            "event": "service_retry_after_reject",
                            "service_options": options,
                            "retry_count": session.service_attempts,
                        },
                    ),
                    suggestions=options,
                    profile=profile,
                )
            # Treat as corrected service input rather than yes/no.
            self._clear_pending_clarification(session)

        selected, score, clarification = self._hybrid_match_option(
            message=message,
            options=options,
            field_id="service_type",
            field_label="Service Type",
            context={"client_name": profile.get("client_name")},
        )
        if clarification:
            if selected:
                self._set_pending_clarification(
                    session,
                    field_id="service_type",
                    value=selected,
                    confidence=score,
                    question_text=clarification,
                )
            return self._response(
                session,
                self._assistant_text(
                    fallback=clarification,
                    phase=session.phase,
                    context={
                        "event": "service_confirm_candidate",
                        "service_options": options,
                        "retry_count": session.service_attempts,
                    },
                ),
                suggestions=["Yes", "No"] if selected else options,
                profile=profile,
            )

        if not selected or score < CLARIFY_CONFIDENCE:
            session.service_attempts += 1
            return self._response(
                session,
                self._assistant_text(
                    fallback=self._service_retry_fallback(session, options),
                    phase=session.phase,
                    context={
                        "event": "service_retry",
                        "service_options": options,
                        "retry_count": session.service_attempts,
                        "user_message": message,
                    },
                ),
                suggestions=options,
                profile=profile,
            )

        return self._activate_service_type(
            session=session,
            profile=profile,
            selected=selected,
            options=options,
        )

    def _handle_question_response(self, session: ChatSession, message: str) -> ChatMessageResponse:
        profile = session.client_profile
        question = self._current_question(session)
        if not profile or not question:
            session.phase = "await_service"
            return self._response(
                session,
                self._assistant_text(
                    fallback="I lost the intake flow state. Let us pick the service again.",
                    phase=session.phase,
                ),
                suggestions=self._service_options(profile) if profile else [],
                profile=profile,
            )

        if session.pending_field_id == question.id:
            clarification_response = self._resolve_pending_clarification(
                session=session,
                question=question,
                message=message,
            )
            if clarification_response is not None:
                return clarification_response

        extraction = self._hybrid_extract_question_answer(
            session=session,
            question=question,
            message=message,
        )

        if extraction["status"] == "clarify":
            self._set_pending_clarification(
                session,
                field_id=question.id,
                value=extraction.get("value"),
                confidence=float(extraction.get("confidence", 0.0)),
                question_text=extraction.get("clarification_question"),
            )
            return self._response(
                session,
                self._assistant_text(
                    fallback=extraction.get("clarification_question")
                    or f"Did you mean: {extraction.get('value')}?",
                    phase=session.phase,
                    context={
                        "question": question.label,
                        "candidate_value": extraction.get("value"),
                        "confidence": extraction.get("confidence"),
                    },
                ),
                suggestions=["Yes", "No"],
                profile=profile,
                service_type=session.service_type,
            )

        if extraction["status"] != "accept":
            return self._response(
                session,
                self._assistant_text(
                    fallback=extraction.get("message") or "Could you rephrase that answer?",
                    phase=session.phase,
                    context={"question": question.label},
                ),
                suggestions=extraction.get("options") or self._question_suggestions(question),
                profile=profile,
                service_type=session.service_type,
            )

        self._clear_pending_clarification(session)
        session.answers[question.id] = extraction["value"]
        session.question_index += 1
        return self._advance_after_answer(session=session, profile=profile)

    def _activate_service_type(
        self,
        *,
        session: ChatSession,
        profile: dict[str, Any],
        selected: str,
        options: list[str],
    ) -> ChatMessageResponse:
        session.service_type = selected
        session.questions = self._build_question_queue(selected)
        session.question_index = 0
        session.phase = "await_question"
        session.summary = None
        session.service_attempts = 0
        self._clear_pending_clarification(session)

        question = self._current_question(session)
        if not question:
            session.phase = "await_service"
            return self._response(
                session,
                self._assistant_text(
                    fallback="I do not have questions configured for that service yet.",
                    phase=session.phase,
                ),
                suggestions=options,
                profile=profile,
            )

        prompt = self._question_prompt(session, question, selected)
        return self._response(
            session,
            prompt,
            suggestions=self._question_suggestions(question),
            profile=profile,
            service_type=selected,
        )

    def _advance_after_answer(
        self,
        *,
        session: ChatSession,
        profile: dict[str, Any],
    ) -> ChatMessageResponse:
        next_question = self._current_question(session)
        if next_question:
            prompt = self._question_prompt(session, next_question, session.service_type or "")
            return self._response(
                session,
                prompt,
                suggestions=self._question_suggestions(next_question),
                profile=profile,
                service_type=session.service_type,
            )

        try:
            payload = self._build_submission_payload(session)
        except Exception:
            session.phase = "await_question"
            session.question_index = max(0, len(session.questions) - 1)
            return self._response(
                session,
                self._assistant_text(
                    fallback=(
                        "I need a few details corrected before I can generate your summary. "
                        "Please check your due date and required fields."
                    ),
                    phase=session.phase,
                ),
                profile=profile,
                service_type=session.service_type,
            )

        summary = generate_summary(
            client_profile=profile,
            payload=payload,
            openai_service=self.openai_service,
        )
        session.summary = summary
        session.phase = "await_confirmation"

        message_text = (
            f"Great, I have everything I need.\n\nMission Summary\n\n{summary}\n\n"
            "Would you like me to submit this request now?"
        )
        return self._response(
            session,
            self._assistant_text(
                fallback=message_text,
                phase=session.phase,
                context={"summary_ready": True},
            ),
            suggestions=["Submit", "Restart"],
            profile=profile,
            service_type=session.service_type,
            ready_to_submit=True,
            summary=summary,
        )

    def _hybrid_match_option(
        self,
        *,
        message: str,
        options: list[str],
        field_id: str,
        field_label: str,
        context: dict[str, Any] | None = None,
    ) -> tuple[str | None, float, str | None]:
        selected, score = match_option(message, options)
        if selected and score >= RULE_ACCEPT_CONFIDENCE:
            return selected, score, None

        llm_result = self.openai_service.extract_structured_answer(
            question_id=field_id,
            question_label=field_label,
            question_type="choice",
            required=True,
            options=options,
            user_message=message,
            context=context,
        )
        if llm_result and llm_result.get("ok"):
            value = llm_result.get("value")
            confidence = float(llm_result.get("confidence", 0.0))
            needs_clarification = bool(llm_result.get("needs_clarification", False))

            if isinstance(value, str) and value in options:
                if confidence >= LLM_ACCEPT_CONFIDENCE and not needs_clarification:
                    return value, confidence, None
                if confidence >= CLARIFY_CONFIDENCE:
                    clarification = llm_result.get("clarification_question") or f'Did you mean "{value}"?'
                    return value, confidence, clarification

            if needs_clarification:
                clarification = llm_result.get("clarification_question")
                if clarification:
                    return None, confidence, str(clarification)

        if selected and score >= CLARIFY_CONFIDENCE:
            return selected, score, f'Did you mean "{selected}"?'
        return None, 0.0, None

    def _hybrid_extract_question_answer(
        self,
        *,
        session: ChatSession,
        question: IntakeQuestion,
        message: str,
    ) -> dict[str, Any]:
        rule_result = normalize_answer(
            answer_text=message,
            question_id=question.id,
            question_type=question.question_type,
            required=question.required,
            options=question.options,
            question_label=question.label,
        )

        if rule_result.get("ok"):
            # For free-text/list fields, deterministic parsing is usually sufficient and faster.
            if question.question_type not in {"choice", "date"}:
                return {
                    "status": "accept",
                    "value": rule_result.get("normalized_value"),
                    "confidence": float(rule_result.get("confidence", 0.0)),
                    "source": "rule",
                }

        if rule_result.get("ok") and float(rule_result.get("confidence", 0.0)) >= RULE_ACCEPT_CONFIDENCE:
            return {
                "status": "accept",
                "value": rule_result.get("normalized_value"),
                "confidence": float(rule_result.get("confidence", 0.0)),
                "source": "rule",
            }

        llm_context = {
            "service_type": session.service_type,
            "known_answers": session.answers,
            "current_phase": session.phase,
        }
        llm_result = self.openai_service.extract_structured_answer(
            question_id=question.id,
            question_label=question.label,
            question_type=question.question_type,
            required=question.required,
            options=question.options or [],
            user_message=message,
            context=llm_context,
        )

        if llm_result and llm_result.get("ok"):
            candidate = self._normalize_candidate_value(question, llm_result.get("value"))
            if candidate["ok"]:
                confidence = float(llm_result.get("confidence", 0.0))
                needs_clarification = bool(llm_result.get("needs_clarification", False))

                if confidence >= LLM_ACCEPT_CONFIDENCE and not needs_clarification:
                    return {
                        "status": "accept",
                        "value": candidate["value"],
                        "confidence": confidence,
                        "source": "llm",
                    }

                if confidence >= CLARIFY_CONFIDENCE or needs_clarification:
                    clarification = llm_result.get("clarification_question") or self._default_clarification_prompt(
                        question=question,
                        candidate_value=candidate["value"],
                    )
                    return {
                        "status": "clarify",
                        "value": candidate["value"],
                        "confidence": confidence,
                        "clarification_question": clarification,
                        "source": "llm",
                    }

        if rule_result.get("ok"):
            confidence = float(rule_result.get("confidence", 0.0))
            if confidence >= CLARIFY_CONFIDENCE:
                candidate = rule_result.get("normalized_value")
                return {
                    "status": "clarify",
                    "value": candidate,
                    "confidence": confidence,
                    "clarification_question": self._default_clarification_prompt(
                        question=question,
                        candidate_value=candidate,
                    ),
                    "source": "rule",
                }

        if question.question_type == "date":
            return {
                "status": "reject",
                "message": (
                    "I can work with natural dates. For example: tomorrow, next Friday, "
                    "March 5, or 2026-03-05. What due date should I use?"
                ),
                "options": [],
            }

        return {
            "status": "reject",
            "message": rule_result.get("message") or "Could you rephrase that answer?",
            "options": rule_result.get("options") or [],
        }

    def _normalize_candidate_value(self, question: IntakeQuestion, value: Any) -> dict[str, Any]:
        if question.id in {"references", "uploaded_files"}:
            if isinstance(value, list):
                normalized_values = [str(item).strip() for item in value if str(item).strip()]
                return {"ok": True, "value": normalized_values}
            if value is None:
                return {"ok": not question.required, "value": []}
            parts = [part.strip() for part in str(value).split(",") if part.strip()]
            return {"ok": True, "value": parts}

        if question.question_type == "choice":
            if not isinstance(value, str):
                return {"ok": False}
            candidate = normalize_answer(
                answer_text=value,
                question_id=question.id,
                question_type=question.question_type,
                required=question.required,
                options=question.options or [],
                question_label=question.label,
            )
            if not candidate.get("ok"):
                return {"ok": False}
            return {"ok": True, "value": candidate.get("normalized_value")}

        if question.question_type == "date":
            if not isinstance(value, str):
                return {"ok": False}
            candidate = normalize_answer(
                answer_text=value,
                question_id=question.id,
                question_type=question.question_type,
                required=question.required,
                options=[],
                question_label=question.label,
            )
            if not candidate.get("ok"):
                return {"ok": False}
            return {"ok": True, "value": candidate.get("normalized_value")}

        if value is None:
            return {"ok": not question.required, "value": ""}
        if isinstance(value, (str, int, float, bool)):
            return {"ok": True, "value": str(value).strip()}
        return {"ok": False}

    def _default_clarification_prompt(self, *, question: IntakeQuestion, candidate_value: Any) -> str:
        if question.question_type == "date":
            return f"To confirm, should I use {candidate_value} as the due date?"
        return f"To confirm, should I use \"{candidate_value}\" for \"{question.label}\"?"

    def _set_pending_clarification(
        self,
        session: ChatSession,
        *,
        field_id: str,
        value: Any,
        confidence: float,
        question_text: str | None,
    ) -> None:
        session.pending_field_id = field_id
        session.pending_value = value
        session.pending_confidence = confidence
        session.pending_question = question_text

    def _clear_pending_clarification(self, session: ChatSession) -> None:
        session.pending_field_id = None
        session.pending_value = None
        session.pending_confidence = 0.0
        session.pending_question = None

    def _resolve_pending_clarification(
        self,
        *,
        session: ChatSession,
        question: IntakeQuestion,
        message: str,
    ) -> ChatMessageResponse | None:
        profile = session.client_profile
        if not profile:
            self._clear_pending_clarification(session)
            return None

        cleaned = message.strip()
        if CONFIRM_PATTERN.search(cleaned):
            value = session.pending_value
            self._clear_pending_clarification(session)
            session.answers[question.id] = value
            session.question_index += 1
            return self._advance_after_answer(session=session, profile=profile)

        if REJECT_PATTERN.search(cleaned):
            self._clear_pending_clarification(session)
            prompt = self._question_prompt(session, question, session.service_type or "")
            return self._response(
                session,
                prompt,
                suggestions=self._question_suggestions(question),
                profile=profile,
                service_type=session.service_type,
            )

        # User likely provided a corrected value directly; continue normal extraction.
        self._clear_pending_clarification(session)
        return None

    def _handle_confirmation(self, session: ChatSession, message: str) -> ChatMessageResponse:
        profile = session.client_profile
        if not profile:
            session.phase = "await_client_code"
            return self._response(
                session,
                self._assistant_text(
                    fallback="I need to re-verify your client code first.",
                    phase=session.phase,
                ),
            )

        lowered = message.strip().lower()
        if RESTART_PATTERN.search(lowered):
            self._reset_intake_only(session)
            options = self._service_options(profile)
            return self._response(
                session,
                self._assistant_text(
                    fallback="No problem. Let us start a new request. What service do you need?",
                    phase=session.phase,
                ),
                suggestions=options,
                profile=profile,
            )

        if not SUBMIT_PATTERN.search(lowered):
            return self._response(
                session,
                self._assistant_text(
                    fallback="Type Submit to send this request, or Restart to begin again.",
                    phase=session.phase,
                ),
                suggestions=["Submit", "Restart"],
                profile=profile,
                service_type=session.service_type,
                ready_to_submit=True,
                summary=session.summary,
            )

        try:
            payload = self._build_submission_payload(session)
            summary = session.summary or generate_summary(
                client_profile=profile,
                payload=payload,
                openai_service=self.openai_service,
            )
            monday_result = self.monday_service.create_item(
                client_profile=profile,
                payload=payload.model_dump(mode="json"),
                summary=summary,
            )
            log = self.store.create_request_log(
                client_code=profile["client_code"],
                client_name=profile["client_name"],
                service_type=payload.service_type,
                project_title=payload.project_title,
                summary=summary,
                payload=payload.model_dump(mode="json"),
                monday_item_id=monday_result.item_id,
            )
            session.phase = "done"
            session.summary = summary
            return self._response(
                session,
                self._assistant_text(
                    fallback=(
                        "Submitted successfully.\n"
                        f"Request ID: {log['id']}\n"
                        f"Monday Item: {monday_result.item_id}\n"
                        f"Mock Mode: {'Yes' if monday_result.mock_mode else 'No'}"
                    ),
                    phase=session.phase,
                ),
                suggestions=["Start New Request"],
                profile=profile,
                service_type=session.service_type,
                summary=summary,
                request_id=str(log["id"]),
                monday_item_id=monday_result.item_id,
            )
        except Exception as exc:
            return self._response(
                session,
                self._assistant_text(
                    fallback=f"I could not submit the request yet. {exc}",
                    phase=session.phase,
                ),
                suggestions=["Submit", "Restart"],
                profile=profile,
                service_type=session.service_type,
                ready_to_submit=True,
                summary=session.summary,
            )

    def _handle_done(self, session: ChatSession, message: str) -> ChatMessageResponse:
        profile = session.client_profile
        if RESTART_PATTERN.search(message) or "start new request" in message.lower():
            self._reset_intake_only(session)
            options = self._service_options(profile) if profile else []
            return self._response(
                session,
                self._assistant_text(
                    fallback="Ready for a new request. What service should we start with?",
                    phase=session.phase,
                ),
                suggestions=options,
                profile=profile,
            )

        return self._response(
            session,
            self._assistant_text(
                fallback="Type Start New Request when you want to create another intake.",
                phase=session.phase,
            ),
            suggestions=["Start New Request"],
            profile=profile,
        )

    def _build_question_queue(self, service_type: str) -> list[IntakeQuestion]:
        branch = BRANCH_QUESTIONS.get(service_type) or BRANCH_QUESTIONS.get("Other", [])
        upload_question = IntakeQuestion(
            id="uploaded_files",
            label="Any files to attach? Share filenames or links.",
            question_type="text",
            required=False,
            options=[],
        )
        return [*CORE_QUESTIONS, *branch, upload_question]

    def _service_options(self, profile: dict[str, Any] | None) -> list[str]:
        if not profile:
            return self.store.list_service_options()
        options = profile.get("service_options") or self.store.list_service_options()
        return [option for option in options if str(option).strip()]

    def _question_prompt(self, session: ChatSession, question: IntakeQuestion, service_type: str) -> str:
        fallback = self._fallback_question_prompt(question, service_type)
        remaining_labels: list[str] = []
        if session.questions:
            for pending in session.questions[session.question_index + 1 :]:
                if pending.label:
                    remaining_labels.append(pending.label)

        generated = self.openai_service.generate_intake_question(
            service_type=service_type,
            question_id=question.id,
            question_label=question.label,
            question_type=question.question_type,
            required=question.required,
            options=question.options or [],
            known_answers=session.answers,
            remaining_question_labels=remaining_labels[:6],
        )
        if generated:
            return generated

        generated_from_general = self.openai_service.generate_chat_reply(
            fallback=fallback,
            phase=session.phase,
            context={
                "service_type": service_type,
                "question_label": question.label,
                "question_type": question.question_type,
                "options": question.options or [],
                "required": question.required,
            },
        )
        return generated_from_general or fallback

    def _fallback_question_prompt(self, question: IntakeQuestion, service_type: str) -> str:
        label = question.label.strip()
        id_based_prompts = {
            "project_title": f"What should we call this {service_type.lower()} request?",
            "goal": "What outcome are you aiming for?",
            "target_audience": "Who is the target audience?",
            "primary_cta": "What is the primary call to action?",
            "due_date": "When do you want this delivered?",
            "approver": "Who should approve this request?",
            "required_elements": "Are there required elements to include (logos, disclaimers, QR code, etc.)?",
            "references": "Any references or links I should use? This is optional.",
            "uploaded_files": "Do you want to attach any files or links? This is optional.",
        }

        if question.id in id_based_prompts:
            return id_based_prompts[question.id]

        if question.question_type == "choice" and question.options:
            return f"{label} Please choose one: {', '.join(question.options)}."

        if question.required:
            return f"Could you share: {label}?"
        return f"Could you share: {label}? This is optional."

    def _welcome_fallback(self, session: ChatSession) -> str:
        if session.user_name:
            return (
                f"{self._time_of_day_greeting()}, {session.user_name}. "
                "Please share your client code so I can start your intake."
            )
        variants = [
            "Hi, I am biaBot. Please share your client code so I can start your intake.",
            "Welcome. I can help capture your request end-to-end. What is your client code?",
            "Hello, I am biaBot. Send your client code and I will walk you through the request.",
        ]
        index = (session.turn_count - 1) % len(variants)
        return variants[index]

    def _try_handle_pre_auth_dialog(
        self,
        *,
        session: ChatSession,
        message: str,
        extracted_candidates: list[str],
    ) -> ChatMessageResponse | None:
        detected_name = self._extract_user_name(message)
        if detected_name:
            session.user_name = detected_name

        if self._looks_like_client_code_attempt(message, extracted_candidates):
            return None

        fallback = self._preauth_dialog_fallback(session, message, detected_name)
        return self._response(
            session,
            self._assistant_text(
                fallback=fallback,
                phase=session.phase,
                context={
                    "event": "pre_auth_dialog",
                    "user_name": session.user_name,
                    "retry_count": session.client_code_attempts,
                    "user_message": message,
                },
            ),
        )

    def _looks_like_client_code_attempt(self, message: str, extracted_candidates: list[str]) -> bool:
        if extracted_candidates:
            return True
        stripped = message.strip()
        if not stripped:
            return False
        if re.search(r"\b(client\s*(?:id|code)|id|code)\b", stripped, re.IGNORECASE):
            return True
        if re.fullmatch(r"[A-Za-z0-9_-]{4,64}", stripped):
            if re.search(r"\d", stripped):
                return True
            if stripped.upper() == stripped and len(stripped) >= 6:
                return True
        return False

    def _extract_user_name(self, message: str) -> str | None:
        match = NAME_PATTERN.search(message)
        if not match:
            return None
        raw = match.group(1).strip()
        if len(raw) < 2:
            return None
        if re.search(r"\d", raw):
            return None
        return raw[0].upper() + raw[1:]

    def _time_of_day_greeting(self) -> str:
        hour = datetime.now().hour
        if hour < 12:
            return "Good morning"
        if hour < 18:
            return "Good afternoon"
        return "Good evening"

    def _preauth_dialog_fallback(
        self,
        session: ChatSession,
        message: str,
        detected_name: str | None,
    ) -> str:
        name = detected_name or session.user_name
        if detected_name:
            return f"Hi {detected_name}. Please share your client code so I can log you in."

        if IDENTITY_PATTERN.search(message):
            if name:
                return (
                    f"Hi {name}. I am biaBot, your intake assistant. "
                    "Please share your client code and I will guide you through the request."
                )
            return (
                "I am biaBot, your intake assistant. "
                "Please share your client code so I can continue."
            )

        if GREETING_PATTERN.search(message):
            greeting = self._time_of_day_greeting()
            if name:
                return f"{greeting}, {name}. Please share your client code so we can continue."
            return f"{greeting}. I am biaBot. Please share your client code to go forward."

        if "?" in message:
            if name:
                return (
                    f"Good question, {name}. I can answer that after login. "
                    "Please share your client code first."
                )
            return "Good question. Please share your client code first, then I can help with the rest."

        if name:
            return f"Thanks {name}. Please share your client code to continue."
        return "Please share your client code when you are ready, and I will continue."

    def _client_code_retry_fallback(
        self,
        session: ChatSession,
        message: str,
        candidates: list[str],
    ) -> str:
        user_prefix = f"{session.user_name}, " if session.user_name else ""
        normalized_candidates = [item.strip() for item in candidates if item and item.strip()]
        preferred = None
        for candidate in normalized_candidates:
            if candidate.lower() == message.lower():
                continue
            if not (re.search(r"[A-Za-z]", candidate) and re.search(r"\d", candidate)):
                continue
            preferred = candidate
            break

        if session.client_code_attempts <= 1:
            return (
                f"{user_prefix}I could not verify that code yet. Please share the exact client code "
                "you received (example: READYONE01)."
            )
        if preferred:
            return (
                f"{user_prefix}I still could not verify \"{preferred}\". Please resend the exact code "
                "without extra words if possible."
            )
        variants = [
            f"{user_prefix}I am still unable to verify that client code. Please double-check it and try again.",
            f"{user_prefix}I still cannot match that client code. Please send the exact code exactly as provided.",
            f"{user_prefix}That code is not matching yet. Re-enter the exact client code and I will continue.",
        ]
        index = (session.client_code_attempts - 2) % len(variants)
        return variants[index]

    def _service_retry_fallback(self, session: ChatSession, options: list[str]) -> str:
        if session.service_attempts <= 1:
            return "I did not catch the service type. Please choose one of these options."
        if session.service_attempts == 2 and options:
            return (
                "I still could not map that service. Please choose the closest match from the list, "
                f"for example \"{options[0]}\"."
            )
        return "I am still not matching the service correctly. Pick one option below and I will continue."

    def _question_suggestions(self, question: IntakeQuestion) -> list[str]:
        options = list(question.options or [])
        if not question.required and question.question_type != "choice":
            options.append("skip")
        return options

    def _phase_suggestions(self, session: ChatSession) -> list[str]:
        if session.phase == "await_service" and session.client_profile:
            return self._service_options(session.client_profile)
        if session.phase == "await_question":
            question = self._current_question(session)
            return self._question_suggestions(question) if question else []
        if session.phase == "await_confirmation":
            return ["Submit", "Restart"]
        if session.phase == "done":
            return ["Start New Request"]
        return []

    def _current_question(self, session: ChatSession) -> IntakeQuestion | None:
        if session.question_index < 0 or session.question_index >= len(session.questions):
            return None
        return session.questions[session.question_index]

    def _reset_intake_only(self, session: ChatSession) -> None:
        session.phase = "await_service" if session.client_profile else "await_client_code"
        session.service_type = None
        session.questions = []
        session.question_index = 0
        session.summary = None
        session.client_code_attempts = 0
        session.service_attempts = 0
        self._clear_pending_clarification(session)
        default_approver = (
            session.client_profile.get("default_approver") if session.client_profile else ""
        )
        session.answers = {"approver": default_approver or ""}

    def _build_submission_payload(self, session: ChatSession) -> IntakeSubmission:
        if not session.service_type:
            raise ValueError("Service type is missing")

        answers = session.answers
        references = self._coerce_list(answers.get("references"))
        uploaded_files = self._coerce_list(answers.get("uploaded_files"))
        branch_answers = {
            key: value
            for key, value in answers.items()
            if key not in CORE_FIELDS and value not in (None, "", [])
        }

        payload = {
            "service_type": session.service_type,
            "project_title": answers.get("project_title") or "",
            "goal": answers.get("goal") or "",
            "target_audience": answers.get("target_audience") or "",
            "primary_cta": answers.get("primary_cta") or "",
            "time_sensitivity": answers.get("time_sensitivity") or "Standard",
            "due_date": answers.get("due_date") or "",
            "approver": answers.get("approver") or None,
            "required_elements": answers.get("required_elements") or None,
            "references": references,
            "uploaded_files": uploaded_files,
            "branch_answers": branch_answers,
            "notes": answers.get("notes") or None,
        }
        return IntakeSubmission.model_validate(payload)

    def _coerce_list(self, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return [part.strip() for part in str(value).split(",") if part.strip()]

    def _assistant_text(
        self,
        *,
        fallback: str,
        phase: str,
        context: dict[str, Any] | None = None,
    ) -> str:
        return self.openai_service.refine_chat_reply(
            fallback=fallback,
            phase=phase,
            context=context or {},
        )

    def _response(
        self,
        session: ChatSession,
        assistant_message: str,
        *,
        suggestions: list[str] | None = None,
        profile: dict[str, Any] | None = None,
        service_type: str | None = None,
        ready_to_submit: bool = False,
        summary: str | None = None,
        request_id: str | None = None,
        monday_item_id: str | None = None,
    ) -> ChatMessageResponse:
        from app.models.schemas import ClientProfile

        profile_payload = profile or session.client_profile
        profile_model = ClientProfile.model_validate(profile_payload) if profile_payload else None
        return ChatMessageResponse(
            session_id=session.session_id,
            assistant_message=assistant_message,
            phase=session.phase,
            suggestions=suggestions or [],
            profile=profile_model,
            service_type=service_type or session.service_type,
            ready_to_submit=ready_to_submit,
            summary=summary,
            request_id=request_id,
            monday_item_id=monday_item_id,
        )
