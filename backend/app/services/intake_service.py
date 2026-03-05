"""Intake summary generation and validation helpers."""

from typing import Any

from app.models.schemas import IntakeSubmission
from app.services.flow_definitions import BRANCH_QUESTIONS, CORE_QUESTIONS
from app.services.openai_service import OpenAIService

UPLOAD_FILES_LABEL = "Any files to attach? Share filenames or links."


def _stringify_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        cleaned = [str(item).strip() for item in value if str(item).strip()]
        return ", ".join(cleaned)
    if hasattr(value, "isoformat"):
        try:
            return str(value.isoformat())
        except Exception:  # pragma: no cover - defensive guard
            pass
    if hasattr(value, "value"):
        enum_value = getattr(value, "value")
        return str(enum_value).strip()
    return str(value).strip()


def _resolve_branch_questions(service_type: str) -> list[Any]:
    direct = BRANCH_QUESTIONS.get(service_type)
    if direct is not None:
        return direct
    normalized_service_type = service_type.strip().lower()
    for option, questions in BRANCH_QUESTIONS.items():
        if option.strip().lower() == normalized_service_type:
            return questions
    return BRANCH_QUESTIONS.get("Other", [])


def _payload_value_for_question(
    *,
    question_id: str,
    payload: IntakeSubmission,
    client_profile: dict[str, Any],
) -> str:
    if question_id == "project_title":
        return _stringify_value(payload.project_title)
    if question_id == "goal":
        return _stringify_value(payload.goal)
    if question_id == "target_audience":
        return _stringify_value(payload.target_audience)
    if question_id == "primary_cta":
        return _stringify_value(payload.primary_cta)
    if question_id == "time_sensitivity":
        return _stringify_value(payload.time_sensitivity)
    if question_id == "due_date":
        return _stringify_value(payload.due_date)
    if question_id == "approver":
        return _stringify_value(payload.approver) or _stringify_value(client_profile.get("default_approver"))
    if question_id == "required_elements":
        return _stringify_value(payload.required_elements)
    if question_id == "references":
        return _stringify_value(payload.references)
    if question_id == "uploaded_files":
        return _stringify_value(payload.uploaded_files)
    return _stringify_value(payload.branch_answers.get(question_id))


def build_fallback_summary(client_profile: dict[str, Any], payload: IntakeSubmission) -> str:
    lines = [
        "**Client Name:** " + _stringify_value(client_profile.get("client_name")),
        "**Client Code:** " + _stringify_value(client_profile.get("client_code")),
        "**Service Type:** " + _stringify_value(payload.service_type),
    ]

    for question in CORE_QUESTIONS:
        answer_text = _payload_value_for_question(
            question_id=question.id,
            payload=payload,
            client_profile=client_profile,
        )
        lines.append(f"**{question.label}:** {answer_text}".rstrip())

    for question in _resolve_branch_questions(payload.service_type):
        answer_text = _payload_value_for_question(
            question_id=question.id,
            payload=payload,
            client_profile=client_profile,
        )
        lines.append(f"**{question.label}:** {answer_text}".rstrip())

    uploaded_files_text = _payload_value_for_question(
        question_id="uploaded_files",
        payload=payload,
        client_profile=client_profile,
    )
    lines.append(f"**{UPLOAD_FILES_LABEL}:** {uploaded_files_text}".rstrip())

    return "\n".join(lines)


def generate_summary(
    *,
    client_profile: dict[str, Any],
    payload: IntakeSubmission,
    openai_service: OpenAIService,
) -> str:
    # Product requirement: each asked question must appear as an independent summary key.
    # Keep summary deterministic so keys are never merged or omitted.
    _ = openai_service
    return build_fallback_summary(client_profile, payload)
