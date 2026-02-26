"""Free-form chatbot answer parsing utilities."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from typing import Any

SKIP_PATTERN = re.compile(r"^(skip|none|na|n/a|not applicable)$", re.IGNORECASE)
YES_PATTERN = re.compile(r"^(yes|y|yeah|yep|sure|affirmative)$", re.IGNORECASE)
NO_PATTERN = re.compile(r"^(no|n|nope|negative)$", re.IGNORECASE)
CLIENT_CODE_TOKEN = re.compile(r"[A-Za-z0-9_-]{3,64}")
CODE_PHRASE = re.compile(
    r"\b(?:client\s*(?:id|code)|id|code)\s*(?:is|=|:)?\s*([A-Za-z0-9_-]{3,64})\b",
    re.IGNORECASE,
)
URL_PATTERN = re.compile(r"https?://[^\s,;]+", re.IGNORECASE)
FILE_PATTERN = re.compile(
    r"\b[^\s,;]+\.(?:pdf|docx?|pptx?|xlsx?|csv|png|jpe?g|gif|zip|txt)\b",
    re.IGNORECASE,
)

CLIENT_CODE_BLACKLIST = {
    "my",
    "client",
    "code",
    "id",
    "is",
    "name",
    "the",
    "for",
    "hello",
    "hi",
    "please",
    "thanks",
    "support",
}

ALIAS_MAP = {
    "campaign": "campaign",
    "graphic": "graphic",
    "newsletter": "newsletter",
    "press": "press release",
    "other": "other",
    "urgent": "urgent",
    "soon": "soon",
    "standard": "standard",
}

DATE_FORMATS = (
    "%Y-%m-%d",
    "%m/%d/%Y",
    "%m/%d/%y",
    "%m-%d-%Y",
    "%m-%d-%y",
    "%B %d, %Y",
    "%B %d %Y",
    "%b %d, %Y",
    "%b %d %Y",
    "%d %B %Y",
    "%d %b %Y",
)


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        key = value.upper()
        if key in seen:
            continue
        seen.add(key)
        unique.append(value)
    return unique


def extract_client_code_candidates(input_text: str) -> list[str]:
    candidates: list[str] = []

    for match in CODE_PHRASE.findall(input_text):
        upper = match.strip().upper()
        if upper:
            candidates.append(upper)

    for token in CLIENT_CODE_TOKEN.findall(input_text):
        token_lower = token.lower()
        if token_lower in CLIENT_CODE_BLACKLIST:
            continue
        if not (re.search(r"[a-z]", token, re.IGNORECASE) and re.search(r"\d", token)):
            continue
        candidates.append(token.upper())

    return dedupe(candidates)


def parse_list_input(input_text: str) -> list[str]:
    return [part.strip() for part in re.split(r"[,\n;]", input_text) if part.strip()]


def parse_links_and_files(input_text: str) -> list[str]:
    extracted = URL_PATTERN.findall(input_text) + FILE_PATTERN.findall(input_text)
    if extracted:
        return dedupe(extracted)
    return parse_list_input(input_text)


def parse_date_input(input_text: str) -> str | None:
    cleaned = re.sub(r"\b(\d+)(st|nd|rd|th)\b", r"\1", input_text, flags=re.IGNORECASE).strip()
    if not cleaned:
        return None

    lowered = cleaned.lower()
    today = date.today()
    if lowered in {"today"}:
        return today.isoformat()
    if lowered in {"tomorrow", "tmr", "tmrw"}:
        return (today + timedelta(days=1)).isoformat()

    weekday_map = {
        "monday": 0,
        "tuesday": 1,
        "wednesday": 2,
        "thursday": 3,
        "friday": 4,
        "saturday": 5,
        "sunday": 6,
    }
    next_weekday = re.fullmatch(r"next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)", lowered)
    if next_weekday:
        target = weekday_map[next_weekday.group(1)]
        days_ahead = (target - today.weekday()) % 7
        days_ahead = 7 if days_ahead == 0 else days_ahead
        return (today + timedelta(days=days_ahead)).isoformat()

    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cleaned):
        return cleaned

    for fmt in DATE_FORMATS:
        try:
            parsed = datetime.strptime(cleaned, fmt)
            return parsed.date().isoformat()
        except ValueError:
            continue

    try:
        parsed = datetime.fromisoformat(cleaned)
        return parsed.date().isoformat()
    except ValueError:
        return None


def _match_by_similarity(input_text: str, options: list[str]) -> tuple[str | None, float]:
    normalized_input = normalize_text(input_text)
    if not normalized_input:
        return None, 0.0

    best_option: str | None = None
    best_score = 0.0
    for option in options:
        normalized_option = normalize_text(option)
        if normalized_option == normalized_input:
            return option, 1.0
        if normalized_input in normalized_option or normalized_option in normalized_input:
            score = 0.92
        else:
            score = SequenceMatcher(None, normalized_input, normalized_option).ratio()
        if score > best_score:
            best_option = option
            best_score = score
    return best_option, best_score


def match_option(input_text: str, options: list[str]) -> tuple[str | None, float]:
    if not options:
        return None, 0.0

    normalized_options = {normalize_text(option): option for option in options}

    if "yes" in normalized_options and "no" in normalized_options:
        if YES_PATTERN.fullmatch(input_text.strip()):
            return normalized_options["yes"], 0.99
        if NO_PATTERN.fullmatch(input_text.strip()):
            return normalized_options["no"], 0.99

    matched, score = _match_by_similarity(input_text, options)
    if matched:
        return matched, score

    normalized_input = normalize_text(input_text)
    for keyword, alias in ALIAS_MAP.items():
        if keyword not in normalized_input:
            continue
        for option in options:
            if alias in normalize_text(option):
                return option, 0.78

    return None, 0.0


def clean_field_prefix(input_text: str, *, question_id: str, question_label: str | None = None) -> str:
    value = input_text.strip()
    if not value:
        return value

    tokens = [question_id.replace("_", " ").strip()]
    if question_label:
        tokens.append(normalize_text(question_label))

    for token in tokens:
        if not token:
            continue
        pattern = re.compile(
            rf"^(?:my|our|the)?\s*{re.escape(token)}\s*(?:is|=|:)?\s*",
            re.IGNORECASE,
        )
        updated = pattern.sub("", value).strip()
        if updated and updated != value:
            return updated

    generic = re.compile(r"^(?:my|our|the)\s+[a-z0-9_\s-]{2,40}\s+(?:is|=|:)\s*", re.IGNORECASE)
    updated = generic.sub("", value).strip()
    return updated or value


def normalize_answer(
    *,
    answer_text: str,
    question_id: str,
    question_type: str,
    required: bool,
    options: list[str] | None = None,
    question_label: str | None = None,
) -> dict[str, Any]:
    options = options or []
    raw = answer_text.strip()
    is_skip = SKIP_PATTERN.fullmatch(raw) is not None

    if not required and (not raw or is_skip):
        return {
            "ok": True,
            "normalized_value": "",
            "matched_option": None,
            "confidence": 1.0,
            "message": None,
            "options": [],
            "entities": {},
        }

    if required and not raw:
        return {
            "ok": False,
            "normalized_value": None,
            "matched_option": None,
            "confidence": 0.0,
            "message": "I need a response for this item before I can continue.",
            "options": options,
            "entities": {},
        }

    if question_type == "choice":
        matched, confidence = match_option(raw, options)
        if not matched:
            return {
                "ok": False,
                "normalized_value": None,
                "matched_option": None,
                "confidence": 0.0,
                "message": "Please choose one of the available options.",
                "options": options,
                "entities": {},
            }
        return {
            "ok": True,
            "normalized_value": matched,
            "matched_option": matched,
            "confidence": round(confidence, 2),
            "message": None,
            "options": [],
            "entities": {},
        }

    if question_type == "date":
        parsed = parse_date_input(raw)
        if not parsed:
            return {
                "ok": False,
                "normalized_value": None,
                "matched_option": None,
                "confidence": 0.0,
                "message": "Please provide a valid date. Use YYYY-MM-DD or natural format like March 5, 2026.",
                "options": [],
                "entities": {},
            }
        return {
            "ok": True,
            "normalized_value": parsed,
            "matched_option": None,
            "confidence": 0.95,
            "message": None,
            "options": [],
            "entities": {},
        }

    lowered_question_id = question_id.lower()
    if lowered_question_id in {"client_code", "client_id"}:
        candidates = extract_client_code_candidates(raw)
        if candidates:
            return {
                "ok": True,
                "normalized_value": candidates[0],
                "matched_option": None,
                "confidence": 0.95,
                "message": None,
                "options": [],
                "entities": {"client_code_candidates": candidates},
            }
        return {
            "ok": False,
            "normalized_value": None,
            "matched_option": None,
            "confidence": 0.0,
            "message": "I could not detect a valid client code in that response.",
            "options": [],
            "entities": {},
        }

    if lowered_question_id in {"references", "uploaded_files"}:
        values = parse_links_and_files(raw)
        return {
            "ok": True,
            "normalized_value": values,
            "matched_option": None,
            "confidence": 0.9,
            "message": None,
            "options": [],
            "entities": {"values_found": len(values)},
        }

    cleaned = clean_field_prefix(raw, question_id=question_id, question_label=question_label)
    return {
        "ok": True,
        "normalized_value": cleaned,
        "matched_option": None,
        "confidence": 0.9 if cleaned != raw else 0.8,
        "message": None,
        "options": [],
        "entities": {},
    }


def extract_due_date(payload: dict[str, Any]) -> date | None:
    candidate = payload.get("due_date")
    if not isinstance(candidate, str):
        return None
    parsed = parse_date_input(candidate)
    if not parsed:
        return None
    return date.fromisoformat(parsed)
