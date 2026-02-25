"""OpenAI utility for optional intake summary polishing."""

import json
from typing import Any

from app.core.config import get_settings

try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None


class OpenAIService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.client = None
        if OpenAI and self.settings.openai_api_key:
            self.client = OpenAI(api_key=self.settings.openai_api_key)

    def summarize_intake(
        self,
        client_profile: dict[str, Any],
        intake_payload: dict[str, Any],
        fallback_summary: str,
    ) -> str:
        if not self.client:
            return fallback_summary

        user_payload = {
            "client_profile": {
                "client_name": client_profile.get("client_name"),
                "preferred_tone": client_profile.get("preferred_tone"),
                "required_disclaimers": client_profile.get("required_disclaimers"),
            },
            "request": intake_payload,
        }

        try:
            completion = self.client.chat.completions.create(
                model=self.settings.openai_model,
                temperature=0.2,
                messages=[
                    {"role": "system", "content": self.settings.intake_system_prompt},
                    {
                        "role": "user",
                        "content": (
                            "Convert this intake JSON into a concise contractor-ready summary. "
                            "No deliverable drafting and no strategic advice.\n\n"
                            + json.dumps(user_payload)
                        ),
                    },
                ],
            )

            text = completion.choices[0].message.content
            return text.strip() if text else fallback_summary
        except Exception:
            return fallback_summary
