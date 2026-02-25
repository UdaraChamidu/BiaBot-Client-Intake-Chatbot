"""Intake summary generation and validation helpers."""

from typing import Any

from app.models.schemas import IntakeSubmission
from app.services.openai_service import OpenAIService


def build_fallback_summary(client_profile: dict[str, Any], payload: IntakeSubmission) -> str:
    links = payload.references if payload.references else ["None provided"]
    files = payload.uploaded_files if payload.uploaded_files else ["None"]

    lines = [
        f"Client: {client_profile.get('client_name', 'Unknown')} ({client_profile.get('client_code', '')})",
        f"Project Title: {payload.project_title}",
        f"Deliverable: {payload.service_type}",
        f"Goal: {payload.goal}",
        f"Audience: {payload.target_audience}",
        f"CTA: {payload.primary_cta}",
        f"Due Date: {payload.due_date.isoformat()}",
        f"Urgency: {payload.time_sensitivity.value}",
        f"Approver: {payload.approver or client_profile.get('default_approver', 'Not specified')}",
        f"Required Elements: {payload.required_elements or 'None specified'}",
        f"Links: {', '.join(links)}",
        f"Files: {', '.join(files)}",
    ]

    if payload.branch_answers:
        lines.append("Branch Details:")
        for key, value in payload.branch_answers.items():
            lines.append(f"- {key}: {value}")

    if payload.notes:
        lines.append(f"Notes: {payload.notes}")

    return "\n".join(lines)


def generate_summary(
    *,
    client_profile: dict[str, Any],
    payload: IntakeSubmission,
    openai_service: OpenAIService,
) -> str:
    fallback = build_fallback_summary(client_profile, payload)
    return openai_service.summarize_intake(
        client_profile=client_profile,
        intake_payload=payload.model_dump(mode="json"),
        fallback_summary=fallback,
    )
