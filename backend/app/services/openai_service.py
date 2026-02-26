"""LLM utility for optional intake summary polishing."""

import json
from typing import Any

import httpx

from app.core.config import get_settings

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


class OpenAIService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.provider = (self.settings.ai_provider or "openai").strip().lower()
        self.client = None

        if self.provider in {"none", "off", "disabled"}:
            return

        if self.provider in {"openai", "openai_compatible"} and OpenAI:
            api_key = self.settings.ai_api_key or self.settings.openai_api_key
            base_url = self.settings.ai_base_url or self.settings.openai_base_url
            if not api_key:
                return

            kwargs: dict[str, Any] = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            self.client = OpenAI(**kwargs)

    def summarize_intake(
        self,
        client_profile: dict[str, Any],
        intake_payload: dict[str, Any],
        fallback_summary: str,
    ) -> str:
        if self.provider in {"none", "off", "disabled"}:
            return fallback_summary

        user_payload = {
            "client_profile": {
                "client_name": client_profile.get("client_name"),
                "preferred_tone": client_profile.get("preferred_tone"),
                "required_disclaimers": client_profile.get("required_disclaimers"),
            },
            "request": intake_payload,
        }

        prompt = (
            "Convert this intake JSON into a concise contractor-ready summary. "
            "No deliverable drafting and no strategic advice.\n\n"
            + json.dumps(user_payload)
        )

        try:
            if self.provider in {"openai", "openai_compatible"}:
                if not self.client:
                    return fallback_summary
                model = self.settings.ai_model or self.settings.openai_model
                completion = self.client.chat.completions.create(
                    model=model,
                    temperature=0.2,
                    messages=[
                        {"role": "system", "content": self.settings.intake_system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                )
                text = completion.choices[0].message.content
                return text.strip() if text else fallback_summary

            if self.provider in {"anthropic", "claude"}:
                api_key = self.settings.anthropic_api_key or self.settings.ai_api_key
                model = self.settings.ai_model or self.settings.anthropic_model
                if not api_key:
                    return fallback_summary

                response = httpx.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": model,
                        "max_tokens": 700,
                        "temperature": 0.2,
                        "system": self.settings.intake_system_prompt,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                    timeout=30.0,
                )
                response.raise_for_status()
                data = response.json()
                content = data.get("content", [])
                if not content:
                    return fallback_summary
                text = content[0].get("text", "")
                return text.strip() if text else fallback_summary

            return fallback_summary
        except Exception:
            return fallback_summary
