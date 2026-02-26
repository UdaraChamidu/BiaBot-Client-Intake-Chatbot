"""Pydantic schemas for API contracts."""

from datetime import date, datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class TimeSensitivity(str, Enum):
    standard = "Standard"
    soon = "Soon"
    urgent = "Urgent"


class ClientCodeRequest(BaseModel):
    client_code: str = Field(min_length=3, max_length=64)


class ClientProfile(BaseModel):
    client_name: str
    client_code: str
    brand_voice_rules: str
    words_to_avoid: list[str] = Field(default_factory=list)
    required_disclaimers: str | None = None
    preferred_tone: str | None = None
    common_audiences: list[str] = Field(default_factory=list)
    default_approver: str | None = None
    subscription_tier: str | None = None
    credit_menu: dict[str, int] = Field(default_factory=dict)
    turnaround_rules: str | None = None
    compliance_notes: str | None = None
    service_options: list[str] = Field(default_factory=list)


class ClientCodeResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    profile: ClientProfile


class IntakeQuestion(BaseModel):
    id: str
    label: str
    question_type: str
    required: bool = True
    options: list[str] = Field(default_factory=list)


class IntakeOptionsResponse(BaseModel):
    service_options: list[str]
    core_questions: list[IntakeQuestion]
    branch_questions: dict[str, list[IntakeQuestion]]


class IntakeSubmission(BaseModel):
    service_type: str
    project_title: str
    goal: str
    target_audience: str
    primary_cta: str
    time_sensitivity: TimeSensitivity
    due_date: date
    approver: str | None = None
    required_elements: str | None = None
    references: list[str] = Field(default_factory=list)
    uploaded_files: list[str] = Field(default_factory=list)
    branch_answers: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None


class IntakeAnswerNormalizationRequest(BaseModel):
    question_id: str = Field(min_length=1, max_length=120)
    question_type: str = Field(min_length=1, max_length=40)
    answer_text: str = Field(min_length=0, max_length=4000)
    required: bool = True
    options: list[str] = Field(default_factory=list)
    question_label: str | None = None


class IntakeAnswerNormalizationResponse(BaseModel):
    ok: bool
    normalized_value: Any | None = None
    matched_option: str | None = None
    confidence: float = 0.0
    message: str | None = None
    options: list[str] = Field(default_factory=list)
    entities: dict[str, Any] = Field(default_factory=dict)


class ChatMessageRequest(BaseModel):
    session_id: str | None = None
    message: str = Field(default="", max_length=4000)
    reset: bool = False


class ChatMessageResponse(BaseModel):
    session_id: str
    assistant_message: str
    phase: str
    suggestions: list[str] = Field(default_factory=list)
    profile: ClientProfile | None = None
    service_type: str | None = None
    ready_to_submit: bool = False
    summary: str | None = None
    request_id: str | None = None
    monday_item_id: str | None = None


class IntakePreviewResponse(BaseModel):
    summary: str


class MondaySubmissionResult(BaseModel):
    item_id: str
    board_id: str | None = None
    mock_mode: bool = True


class IntakeSubmitResponse(BaseModel):
    request_id: str
    summary: str
    monday: MondaySubmissionResult


class MondayCredentialCheckRequest(BaseModel):
    api_token: str | None = None
    board_id: str | None = None
    query: str | None = None
    force_live: bool = False


class MondayCredentialCheckResponse(BaseModel):
    ok: bool
    mock_mode: bool = False
    api_url: str
    account_id: str | None = None
    account_name: str | None = None
    board_id: str | None = None
    board_name: str | None = None
    board_found: bool | None = None
    error: str | None = None


class ServiceOptionsUpdate(BaseModel):
    options: list[str]


class RequestLogRecord(BaseModel):
    id: str
    created_at: datetime
    client_code: str
    client_name: str
    service_type: str
    project_title: str
    summary: str
    monday_item_id: str | None = None
    payload: dict[str, Any]
