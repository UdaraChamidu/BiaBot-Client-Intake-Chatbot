"""Deepgram speech-to-text integration."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class DeepgramService:
    def __init__(self) -> None:
        self.settings = get_settings()

    @property
    def available(self) -> bool:
        has_key = bool(self.settings.deepgram_api_key)
        enabled = bool(self.settings.voice_enabled)
        if not enabled:
            logger.warning("Deepgram STT unavailable: voice_enabled is False")
        if not has_key:
            logger.warning("Deepgram STT unavailable: deepgram_api_key is not set")
        return enabled and has_key

    async def transcribe_audio(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str | None = None,
    ) -> dict[str, Any]:
        if not self.available:
            raise RuntimeError("Deepgram voice transcription is not configured.")

        params: dict[str, str] = {
            "model": self.settings.deepgram_model,
            "smart_format": str(self.settings.deepgram_smart_format).lower(),
            "punctuate": str(self.settings.deepgram_punctuate).lower(),
        }

        if self.settings.deepgram_language:
            params["language"] = self.settings.deepgram_language
        elif self.settings.deepgram_detect_language:
            params["detect_language"] = "true"

        headers = {
            "Authorization": f"Token {self.settings.deepgram_api_key}",
            "Content-Type": mime_type or "application/octet-stream",
        }

        timeout = httpx.Timeout(self.settings.voice_request_timeout_seconds)
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                self.settings.deepgram_api_url,
                params=params,
                headers=headers,
                content=audio_bytes,
            )

        if response.status_code >= 400:
            error_msg = self._extract_error_message(response)
            logger.error("Deepgram API error (HTTP %s): %s", response.status_code, error_msg)
            raise RuntimeError(error_msg)

        payload = response.json()
        results = payload.get("results") or {}
        channels = results.get("channels") or []
        first_channel = channels[0] if channels else {}
        alternatives = first_channel.get("alternatives") or []
        first_alternative = alternatives[0] if alternatives else {}

        transcript = str(first_alternative.get("transcript") or "").strip()
        confidence = float(first_alternative.get("confidence") or 0.0)

        metadata = payload.get("metadata") or {}
        duration_seconds = metadata.get("duration")
        detected_language = first_channel.get("detected_language")

        return {
            "transcript": transcript,
            "confidence": confidence,
            "duration_seconds": float(duration_seconds) if duration_seconds is not None else None,
            "detected_language": str(detected_language).strip() if detected_language else None,
        }

    def _extract_error_message(self, response: httpx.Response) -> str:
        try:
            payload = response.json()
        except Exception:
            payload = None

        if isinstance(payload, dict):
            if isinstance(payload.get("err_msg"), str) and payload["err_msg"].strip():
                return payload["err_msg"].strip()
            if isinstance(payload.get("message"), str) and payload["message"].strip():
                return payload["message"].strip()
            if isinstance(payload.get("error"), str) and payload["error"].strip():
                return payload["error"].strip()

        return "Deepgram could not transcribe the uploaded audio."
