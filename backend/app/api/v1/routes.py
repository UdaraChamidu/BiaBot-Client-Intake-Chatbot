"""API routes for auth, intake, and admin functions."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.core.rate_limit import rate_limiter
from app.core.security import (
    create_client_token,
    get_client_context,
    is_valid_admin_secret,
    require_admin,
)
from app.models.schemas import (
    AdminClientProfileUpsert,
    AdminAuthRequest,
    AdminAuthResponse,
    ChatMessageRequest,
    ChatMessageResponse,
    ClientCodeRequest,
    ClientCodeResponse,
    ClientProfile,
    IntakeAnswerNormalizationRequest,
    IntakeAnswerNormalizationResponse,
    IntakeOptionsResponse,
    IntakePreviewResponse,
    IntakeSubmitResponse,
    IntakeSubmission,
    MondayCredentialCheckRequest,
    MondayCredentialCheckResponse,
    RequestLogRecord,
    ServiceOptionsUpdate,
)
from app.services.chat_agent_service import ChatAgentService
from app.services.chat_parser import extract_client_code_candidates, normalize_answer
from app.services.flow_definitions import BRANCH_QUESTIONS, CORE_QUESTIONS
from app.services.intake_service import generate_summary
from app.services.monday_service import MondayService
from app.services.openai_service import OpenAIService
from app.services.store import get_store

router = APIRouter()
store = get_store()
openai_service = OpenAIService()
monday_service = MondayService()
chat_agent_service = ChatAgentService(
    store=store,
    openai_service=openai_service,
    monday_service=monday_service,
)


@router.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/chat/message", response_model=ChatMessageResponse, tags=["chat"])
def chat_message(payload: ChatMessageRequest) -> ChatMessageResponse:
    return chat_agent_service.process_message(
        message=payload.message,
        session_id=payload.session_id,
        reset=payload.reset,
    )


@router.post("/auth/client-code", response_model=ClientCodeResponse, tags=["auth"])
def authenticate_client(payload: ClientCodeRequest, request: Request) -> ClientCodeResponse:
    remote = request.client.host if request.client else "unknown"
    rate_limiter.check(key=f"auth:{remote}", limit=15, window_seconds=60)

    raw_client_input = payload.client_code.strip()
    candidates = [raw_client_input]
    candidates.extend(extract_client_code_candidates(raw_client_input))

    profile = None
    seen: set[str] = set()
    for candidate in candidates:
        normalized_candidate = candidate.strip().upper()
        if not normalized_candidate or normalized_candidate in seen:
            continue
        seen.add(normalized_candidate)
        profile = store.get_client_profile(normalized_candidate)
        if profile:
            break

    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid client code")

    token = create_client_token(
        client_code=profile["client_code"],
        client_name=profile["client_name"],
    )
    return ClientCodeResponse(access_token=token, profile=ClientProfile.model_validate(profile))


@router.get("/client/profile", response_model=ClientProfile, tags=["client"])
def get_client_profile(client_ctx: dict[str, str] = Depends(get_client_context)) -> ClientProfile:
    profile = store.get_client_profile(client_ctx["client_code"])
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client profile not found")
    return ClientProfile.model_validate(profile)


@router.get("/intake/options", response_model=IntakeOptionsResponse, tags=["intake"])
def get_intake_options(client_ctx: dict[str, str] = Depends(get_client_context)) -> IntakeOptionsResponse:
    profile = store.get_client_profile(client_ctx["client_code"])
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client profile not found")

    service_options = profile.get("service_options") or store.list_service_options()
    return IntakeOptionsResponse(
        service_options=service_options,
        core_questions=CORE_QUESTIONS,
        branch_questions=BRANCH_QUESTIONS,
    )


@router.post("/intake/normalize-answer", response_model=IntakeAnswerNormalizationResponse, tags=["intake"])
def normalize_intake_answer(
    payload: IntakeAnswerNormalizationRequest,
    client_ctx: dict[str, str] = Depends(get_client_context),
) -> IntakeAnswerNormalizationResponse:
    profile = store.get_client_profile(client_ctx["client_code"])
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client profile not found")

    normalized = normalize_answer(
        answer_text=payload.answer_text,
        question_id=payload.question_id,
        question_type=payload.question_type,
        required=payload.required,
        options=payload.options,
        question_label=payload.question_label,
    )
    return IntakeAnswerNormalizationResponse.model_validate(normalized)


@router.post("/intake/preview", response_model=IntakePreviewResponse, tags=["intake"])
def preview_submission(
    payload: IntakeSubmission,
    client_ctx: dict[str, str] = Depends(get_client_context),
) -> IntakePreviewResponse:
    profile = store.get_client_profile(client_ctx["client_code"])
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client profile not found")

    if not payload.approver:
        payload.approver = profile.get("default_approver")

    summary = generate_summary(client_profile=profile, payload=payload, openai_service=openai_service)
    return IntakePreviewResponse(summary=summary)


@router.post("/intake/submit", response_model=IntakeSubmitResponse, tags=["intake"])
def submit_intake(
    payload: IntakeSubmission,
    client_ctx: dict[str, str] = Depends(get_client_context),
) -> IntakeSubmitResponse:
    profile = store.get_client_profile(client_ctx["client_code"])
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client profile not found")

    if not payload.approver:
        payload.approver = profile.get("default_approver")

    summary = generate_summary(client_profile=profile, payload=payload, openai_service=openai_service)
    monday_result = monday_service.create_item(
        client_profile=profile,
        payload=payload.model_dump(mode="json"),
        summary=summary,
    )

    log = store.create_request_log(
        client_code=profile["client_code"],
        client_name=profile["client_name"],
        service_type=payload.service_type,
        project_title=payload.project_title,
        summary=summary,
        payload=payload.model_dump(mode="json"),
        monday_item_id=monday_result.item_id,
    )

    return IntakeSubmitResponse(request_id=str(log["id"]), summary=summary, monday=monday_result)


@router.post("/admin/auth", response_model=AdminAuthResponse, tags=["admin"])
def admin_auth(payload: AdminAuthRequest) -> AdminAuthResponse:
    if not is_valid_admin_secret(payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin password")
    return AdminAuthResponse(ok=True)


@router.get("/admin/client-profiles", response_model=list[ClientProfile], tags=["admin"])
def admin_list_client_profiles(_: None = Depends(require_admin)) -> list[ClientProfile]:
    return [ClientProfile.model_validate(row) for row in store.list_client_profiles()]


@router.post("/admin/client-profiles", response_model=ClientProfile, tags=["admin"])
def admin_upsert_client_profile(
    payload: AdminClientProfileUpsert,
    _: None = Depends(require_admin),
) -> ClientProfile:
    saved = store.upsert_client_profile(payload.model_dump())
    return ClientProfile.model_validate(saved)


@router.put("/admin/client-profiles/{client_code}", response_model=ClientProfile, tags=["admin"])
def admin_update_client_profile(
    client_code: str,
    payload: AdminClientProfileUpsert,
    _: None = Depends(require_admin),
) -> ClientProfile:
    if payload.client_code != client_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path code must match payload code")
    saved = store.upsert_client_profile(payload.model_dump())
    return ClientProfile.model_validate(saved)


@router.delete("/admin/client-profiles/{client_code}", status_code=status.HTTP_204_NO_CONTENT, tags=["admin"])
def admin_delete_client_profile(
    client_code: str,
    _: None = Depends(require_admin),
) -> None:
    deleted = store.delete_client_profile(client_code.strip().upper())
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Client profile not found")


@router.get("/admin/service-options", response_model=list[str], tags=["admin"])
def admin_get_service_options(_: None = Depends(require_admin)) -> list[str]:
    return store.list_service_options()


@router.put("/admin/service-options", response_model=list[str], tags=["admin"])
def admin_set_service_options(
    payload: ServiceOptionsUpdate,
    _: None = Depends(require_admin),
) -> list[str]:
    cleaned = [option.strip() for option in payload.options if option.strip()]
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one service option is required")
    return store.set_service_options(cleaned)


@router.get("/admin/request-logs", response_model=list[RequestLogRecord], tags=["admin"])
def admin_get_request_logs(
    limit: int = Query(default=50, ge=1, le=500),
    _: None = Depends(require_admin),
) -> list[RequestLogRecord]:
    rows = store.list_request_logs(limit=limit)
    normalized: list[dict[str, Any]] = []
    for row in rows:
        normalized.append(row)
    return [RequestLogRecord.model_validate(row) for row in normalized]


@router.post("/admin/monday/verify", response_model=MondayCredentialCheckResponse, tags=["admin"])
def admin_verify_monday_credentials(
    payload: MondayCredentialCheckRequest,
    _: None = Depends(require_admin),
) -> MondayCredentialCheckResponse:
    result = monday_service.verify_credentials(
        api_token=payload.api_token,
        board_id=payload.board_id,
        query=payload.query,
        force_live=payload.force_live,
    )
    return result
