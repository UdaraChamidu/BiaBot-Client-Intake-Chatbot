"""ElevenLabs text-to-speech integration."""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import get_settings


class ElevenLabsService:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def available(self) -> bool:
        return bool(self.settings.voice_enabled and self.settings.elevenlabs_api_key)

    async def list_voices(self) -> dict[str, Any]:
        if not self.available:
            raise RuntimeError("ElevenLabs voice synthesis is not configured.")

        headers = {
            "xi-api-key": self.settings.elevenlabs_api_key or "",
        }

        timeout = httpx.Timeout(self.settings.voice_request_timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                f"{self.settings.elevenlabs_api_url.rstrip('/')}/v2/voices",
                headers=headers,
                params={"page_size": 100},
            )

        if response.status_code >= 400:
            raise RuntimeError(self._extract_error_message(response))

        payload = response.json()
        raw_voices = payload.get("voices") or []
        voices: list[dict[str, Any]] = []
        for item in raw_voices:
            voice_id = str(item.get("voice_id") or "").strip()
            name = str(item.get("name") or "").strip()
            if not voice_id or not name:
                continue
            voices.append(
                {
                    "voice_id": voice_id,
                    "name": name,
                    "category": str(item.get("category") or "").strip() or None,
                    "preview_url": str(item.get("preview_url") or "").strip() or None,
                }
            )

        default_voice_id = self.settings.elevenlabs_voice_id
        if default_voice_id and not any(voice["voice_id"] == default_voice_id for voice in voices):
            default_voice_id = None
        if not default_voice_id and voices:
            default_voice_id = voices[0]["voice_id"]

        return {
            "voices": voices,
            "default_voice_id": default_voice_id,
        }

    async def synthesize_text(
        self,
        *,
        text: str,
        voice_id: str | None = None,
        model_id: str | None = None,
    ) -> dict[str, Any]:
        if not self.available:
            raise RuntimeError("ElevenLabs voice synthesis is not configured.")

        selected_voice_id = str(voice_id or self.settings.elevenlabs_voice_id or "").strip()
        if not selected_voice_id:
            voices_payload = await self.list_voices()
            selected_voice_id = str(voices_payload.get("default_voice_id") or "").strip()

        if not selected_voice_id:
            raise RuntimeError("No ElevenLabs voices are available for this account.")

        request_body: dict[str, Any] = {
            "text": text,
            "model_id": model_id or self.settings.elevenlabs_model_id,
        }
        if self.settings.elevenlabs_language_code:
            request_body["language_code"] = self.settings.elevenlabs_language_code

        headers = {
            "xi-api-key": self.settings.elevenlabs_api_key or "",
            "Accept": "audio/mpeg",
        }

        timeout = httpx.Timeout(self.settings.voice_request_timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                f"{self.settings.elevenlabs_api_url.rstrip('/')}/v1/text-to-speech/{selected_voice_id}",
                params={"output_format": self.settings.elevenlabs_output_format},
                headers=headers,
                json=request_body,
            )

        if response.status_code >= 400:
            raise RuntimeError(self._extract_error_message(response))

        return {
            "audio_bytes": response.content,
            "media_type": response.headers.get("content-type", "audio/mpeg"),
            "voice_id": selected_voice_id,
        }

    def _extract_error_message(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except Exception:
            payload = None

        if isinstance(payload, dict):
            detail = payload.get("detail")
            if isinstance(detail, dict):
                message = detail.get("message")
                if isinstance(message, str) and message.strip():
                    return message.strip()
            if isinstance(detail, str) and detail.strip():
                return detail.strip()
            if isinstance(payload.get("message"), str) and payload["message"].strip():
                return payload["message"].strip()

        return "ElevenLabs could not synthesize audio for this message."
