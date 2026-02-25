"""API routes for auth, intake, and admin functions."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.core.rate_limit import rate_limiter
from app.core.security import create_client_token, get_client_context, require_admin
from app.models.schemas import (
    ClientCodeRequest,
    ClientCodeResponse,
    ClientProfile,
    IntakeOptionsResponse,
    IntakePreviewResponse,
    IntakeSubmitResponse,
    IntakeSubmission,
    RequestLogRecord,
    ServiceOptionsUpdate,
)
from app.services.flow_definitions import BRANCH_QUESTIONS, CORE_QUESTIONS
from app.services.intake_service import generate_summary
from app.services.monday_service import MondayService
from app.services.openai_service import OpenAIService
from app.services.store import get_store

router = APIRouter()
store = get_store()
openai_service = OpenAIService()
monday_service = MondayService()


@router.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/client-code", response_model=ClientCodeResponse, tags=["auth"])
def authenticate_client(payload: ClientCodeRequest, request: Request) -> ClientCodeResponse:
    remote = request.client.host if request.client else "unknown"
    rate_limiter.check(key=f"auth:{remote}", limit=15, window_seconds=60)

    profile = store.get_client_profile(payload.client_code.strip())
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


@router.get("/admin/client-profiles", response_model=list[ClientProfile], tags=["admin"])
def admin_list_client_profiles(_: None = Depends(require_admin)) -> list[ClientProfile]:
    return [ClientProfile.model_validate(row) for row in store.list_client_profiles()]


@router.post("/admin/client-profiles", response_model=ClientProfile, tags=["admin"])
def admin_upsert_client_profile(
    payload: ClientProfile,
    _: None = Depends(require_admin),
) -> ClientProfile:
    saved = store.upsert_client_profile(payload.model_dump())
    return ClientProfile.model_validate(saved)


@router.put("/admin/client-profiles/{client_code}", response_model=ClientProfile, tags=["admin"])
def admin_update_client_profile(
    client_code: str,
    payload: ClientProfile,
    _: None = Depends(require_admin),
) -> ClientProfile:
    if payload.client_code != client_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path code must match payload code")
    saved = store.upsert_client_profile(payload.model_dump())
    return ClientProfile.model_validate(saved)


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
