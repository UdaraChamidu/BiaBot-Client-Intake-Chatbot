"""ElevenLabs text-to-speech integration."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from elevenlabs.client import ElevenLabs

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class ElevenLabsService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client: ElevenLabs | None = None

    @property
    def available(self) -> bool:
        has_key = bool(self.settings.elevenlabs_api_key)
        enabled = bool(self.settings.voice_enabled)
        if not enabled:
            logger.warning("ElevenLabs TTS unavailable: voice_enabled is False")
        if not has_key:
            logger.warning("ElevenLabs TTS unavailable: elevenlabs_api_key is not set")
        return enabled and has_key

    async def list_voices(self) -> dict[str, Any]:
        if not self.available:
            raise RuntimeError("ElevenLabs voice synthesis is not configured.")

        try:
            return await asyncio.to_thread(self._list_voices_sync)
        except Exception as exc:
            error_msg = self._extract_error_message(
                exc,
                fallback="ElevenLabs could not list available voices.",
            )
            logger.error("ElevenLabs SDK error while listing voices: %s", error_msg)
            raise RuntimeError(error_msg) from None

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

        try:
            audio_bytes, media_type = await asyncio.to_thread(
                self._synthesize_text_sync,
                text,
                selected_voice_id,
                model_id or self.settings.elevenlabs_model_id,
            )
        except Exception as exc:
            error_msg = self._extract_error_message(exc)
            logger.error("ElevenLabs SDK error while synthesizing audio: %s", error_msg)
            raise RuntimeError(error_msg)

        return {
            "audio_bytes": audio_bytes,
            "media_type": media_type,
            "voice_id": selected_voice_id,
        }

    def _get_client(self) -> ElevenLabs:
        if self._client is None:
            self._client = ElevenLabs(api_key=self.settings.elevenlabs_api_key or "")
        return self._client

    def _list_voices_sync(self) -> dict[str, Any]:
        client = self._get_client()
        payload = client.voices.search(page_size=100)
        raw_voices = list(getattr(payload, "voices", None) or [])
        voices: list[dict[str, Any]] = []
        for item in raw_voices:
            voice_id = self._read_field(item, "voice_id")
            name = self._read_field(item, "name")
            if not voice_id or not name:
                continue
            voices.append(
                {
                    "voice_id": voice_id,
                    "name": name,
                    "category": self._read_field(item, "category"),
                    "preview_url": self._read_field(item, "preview_url"),
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

    def _synthesize_text_sync(
        self,
        text: str,
        voice_id: str,
        model_id: str,
    ) -> tuple[bytes, str]:
        client = self._get_client()
        request_body: dict[str, Any] = {
            "voice_id": voice_id,
            "text": text,
            "model_id": model_id,
            "output_format": self.settings.elevenlabs_output_format,
        }
        if self.settings.elevenlabs_language_code:
            request_body["language_code"] = self.settings.elevenlabs_language_code
        with client.text_to_speech.with_raw_response.convert(**request_body) as response:
            return (
                self._coerce_audio_bytes(response.data),
                str(
                    response.headers.get("content-type")
                    or self._resolve_media_type(self.settings.elevenlabs_output_format)
                ),
            )

    def _coerce_audio_bytes(self, audio: Any) -> bytes:
        if isinstance(audio, bytes):
            return audio
        if isinstance(audio, bytearray):
            return bytes(audio)
        if isinstance(audio, memoryview):
            return audio.tobytes()
        if hasattr(audio, "__iter__"):
            chunks: list[bytes] = []
            for chunk in audio:
                if not chunk:
                    continue
                if isinstance(chunk, memoryview):
                    chunks.append(chunk.tobytes())
                    continue
                if isinstance(chunk, bytearray):
                    chunks.append(bytes(chunk))
                    continue
                if isinstance(chunk, bytes):
                    chunks.append(chunk)
            joined = b"".join(chunks)
            if joined:
                return joined
        raise RuntimeError("ElevenLabs returned empty audio.")

    def _read_field(self, item: Any, field_name: str) -> str | None:
        if isinstance(item, dict):
            raw_value = item.get(field_name)
        else:
            raw_value = getattr(item, field_name, None)
        text = str(raw_value or "").strip()
        return text or None

    def _resolve_media_type(self, output_format: str | None) -> str:
        normalized = str(output_format or "").strip().lower()
        if normalized.startswith("pcm"):
            return "audio/pcm"
        if normalized.startswith("wav"):
            return "audio/wav"
        return "audio/mpeg"

    def _extract_error_message(self, error: Exception, fallback: str | None = None) -> str:
        body = getattr(error, "body", None)
        if isinstance(body, dict):
            detail = body.get("detail")
            if isinstance(detail, dict):
                message = detail.get("message")
                if isinstance(message, str) and message.strip():
                    return message.strip()
            if isinstance(detail, str) and detail.strip():
                return detail.strip()
            message = body.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()

        message_text = str(error).strip()
        if message_text:
            return message_text
        return fallback or "ElevenLabs could not synthesize audio for this message."
