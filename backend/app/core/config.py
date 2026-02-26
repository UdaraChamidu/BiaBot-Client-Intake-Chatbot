"""Application configuration."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Bianomics Intake API"
    app_env: str = "development"
    cors_origins: str = "http://localhost:5173"
    use_in_memory_store: bool = True

    supabase_url: str | None = None
    supabase_service_key: str | None = None

    jwt_secret: str = "dev-jwt-secret-change-this-32-bytes-minimum"
    jwt_algorithm: str = "HS256"
    jwt_exp_minutes: int = 480
    admin_api_key: str = "dev-admin-key"

    monday_api_url: str = "https://api.monday.com/v2"
    monday_api_token: str | None = None
    monday_board_id: str | None = None
    monday_mock_mode: bool = True
    monday_column_map_json: str = (
        '{"status":"status","client":"text_client","client_code":"text_code",'
        '"service_type":"text_service","audience":"text_audience",'
        '"due_date":"date_due","urgency":"text_urgency","approver":"text_approver",'
        '"summary":"long_summary","links":"long_links"}'
    )

    ai_provider: str = "openai"
    ai_model: str | None = None
    ai_api_key: str | None = None
    ai_base_url: str | None = None

    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    openai_base_url: str | None = None

    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-3-5-sonnet-latest"
    intake_system_prompt: str = (
        "You are an intake assistant. Stay in intake mode only. "
        "Ask and organize project request information only. "
        "Do not generate final deliverables or legal or financial advice."
    )

    @property
    def cors_origins_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
