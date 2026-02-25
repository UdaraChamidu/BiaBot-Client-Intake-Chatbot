"""Storage abstraction with Supabase and in-memory implementations."""

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.core.config import get_settings
from app.data.sample_data import DEFAULT_CLIENT_PROFILE, DEFAULT_SERVICE_OPTIONS

try:
    from supabase import Client, create_client
except Exception:  # pragma: no cover
    Client = Any  # type: ignore[assignment]
    create_client = None


class InMemoryStore:
    def __init__(self) -> None:
        self.client_profiles: dict[str, dict[str, Any]] = {
            DEFAULT_CLIENT_PROFILE["client_code"]: dict(DEFAULT_CLIENT_PROFILE)
        }
        self.service_options = list(DEFAULT_SERVICE_OPTIONS)
        self.request_logs: list[dict[str, Any]] = []

    def get_client_profile(self, client_code: str) -> dict[str, Any] | None:
        return self.client_profiles.get(client_code)

    def list_client_profiles(self) -> list[dict[str, Any]]:
        return list(self.client_profiles.values())

    def upsert_client_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        self.client_profiles[profile["client_code"]] = profile
        return profile

    def list_service_options(self) -> list[str]:
        return self.service_options

    def set_service_options(self, options: list[str]) -> list[str]:
        self.service_options = options
        return self.service_options

    def create_request_log(
        self,
        *,
        client_code: str,
        client_name: str,
        service_type: str,
        project_title: str,
        summary: str,
        payload: dict[str, Any],
        monday_item_id: str | None,
    ) -> dict[str, Any]:
        record = {
            "id": str(uuid4()),
            "created_at": datetime.now(timezone.utc),
            "client_code": client_code,
            "client_name": client_name,
            "service_type": service_type,
            "project_title": project_title,
            "summary": summary,
            "monday_item_id": monday_item_id,
            "payload": payload,
        }
        self.request_logs.insert(0, record)
        return record

    def list_request_logs(self, limit: int = 100) -> list[dict[str, Any]]:
        return self.request_logs[:limit]


class SupabaseStore:
    def __init__(self, url: str, service_key: str) -> None:
        if create_client is None:
            raise RuntimeError("supabase dependency is not available")
        self.client: Client = create_client(url, service_key)

    def get_client_profile(self, client_code: str) -> dict[str, Any] | None:
        response = (
            self.client.table("client_profiles")
            .select("*")
            .eq("client_code", client_code)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else None

    def list_client_profiles(self) -> list[dict[str, Any]]:
        response = self.client.table("client_profiles").select("*").order("client_name").execute()
        return response.data or []

    def upsert_client_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        response = (
            self.client.table("client_profiles")
            .upsert(profile, on_conflict="client_code")
            .execute()
        )
        rows = response.data or []
        return rows[0] if rows else profile

    def list_service_options(self) -> list[str]:
        response = (
            self.client.table("service_options")
            .select("options")
            .eq("scope", "global")
            .limit(1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            return list(DEFAULT_SERVICE_OPTIONS)
        return rows[0].get("options") or list(DEFAULT_SERVICE_OPTIONS)

    def set_service_options(self, options: list[str]) -> list[str]:
        self.client.table("service_options").upsert(
            {"scope": "global", "options": options},
            on_conflict="scope",
        ).execute()
        return options

    def create_request_log(
        self,
        *,
        client_code: str,
        client_name: str,
        service_type: str,
        project_title: str,
        summary: str,
        payload: dict[str, Any],
        monday_item_id: str | None,
    ) -> dict[str, Any]:
        row = {
            "client_code": client_code,
            "client_name": client_name,
            "service_type": service_type,
            "project_title": project_title,
            "summary": summary,
            "payload": payload,
            "monday_item_id": monday_item_id,
        }
        response = self.client.table("request_logs").insert(row).execute()
        rows = response.data or []
        return rows[0] if rows else row

    def list_request_logs(self, limit: int = 100) -> list[dict[str, Any]]:
        response = (
            self.client.table("request_logs")
            .select("*")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return response.data or []


_store: InMemoryStore | SupabaseStore | None = None


def get_store() -> InMemoryStore | SupabaseStore:
    global _store
    if _store is not None:
        return _store

    settings = get_settings()
    if not settings.use_in_memory_store and settings.supabase_url and settings.supabase_service_key:
        _store = SupabaseStore(settings.supabase_url, settings.supabase_service_key)
    else:
        _store = InMemoryStore()
    return _store
