"""Utilities for exporting intake submissions as simple PDF files."""

from __future__ import annotations

import re
import textwrap
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


SUMMARY_PAIR_PATTERNS = (
    re.compile(r"^\s*(?:[-*]\s+)?\*\*(.+?):\*\*\s*(.*)$"),
    re.compile(r"^\s*(?:[-*]\s+)?\*\*(.+?)\*\*\s*:\s*(.*)$"),
    re.compile(r"^\s*(?:[-*]\s+)?([^:\n]+?):\s*(.*)$"),
)


@dataclass(frozen=True)
class PdfBlock:
    text: str
    font: str = "F1"
    size: int = 11
    x: int = 54
    leading: int = 15
    before: int = 0
    after: int = 0
    max_chars: int | None = None


class IntakePdfService:
    """Generate compact, dependency-free PDF exports for intake data."""

    def build_pdf(self, export_data: dict[str, Any]) -> bytes:
        blocks = self._build_blocks(export_data)
        page_commands = self._paginate(blocks)
        return self._build_pdf_document(page_commands)

    def build_filename(self, export_data: dict[str, Any]) -> str:
        client_part = self._slugify(export_data.get("client_name")) or "client"
        project_part = self._slugify(export_data.get("project_title"))
        if project_part:
            return f"{client_part}-{project_part}-intake-summary.pdf"
        return f"{client_part}-intake-summary.pdf"

    def _build_blocks(self, export_data: dict[str, Any]) -> list[PdfBlock]:
        client_name = self._display_text(export_data.get("client_name"), fallback="Unknown Client")
        client_code = self._display_text(export_data.get("client_code"), fallback="-")
        service_type = self._display_text(export_data.get("service_type"), fallback="-")
        project_title = self._display_text(export_data.get("project_title"), fallback="Untitled Request")
        created_at = self._format_datetime(export_data.get("created_at"))
        exported_at = self._format_datetime(datetime.now(timezone.utc))
        monday_item_id = self._display_text(export_data.get("monday_item_id"), fallback="-")
        summary = self._display_text(export_data.get("summary"), fallback="Summary not available.")
        payload = export_data.get("payload")
        answer_rows = self._build_submission_answer_rows(payload)
        summary_rows = self._parse_summary_rows(summary)

        blocks = [
            PdfBlock(f"{client_name} Intake Summary", font="F2", size=18, leading=22, after=4),
            PdfBlock("Bianomics client intake export", size=10, leading=13, after=12),
            PdfBlock("Request Overview", font="F2", size=13, leading=18, before=2, after=2),
            PdfBlock(f"Client Name: {client_name}"),
            PdfBlock(f"Client Code: {client_code}"),
            PdfBlock(f"Service Type: {service_type}"),
            PdfBlock(f"Project Title: {project_title}"),
            PdfBlock(f"Submission Date: {created_at}"),
            PdfBlock(f"Monday Item ID: {monday_item_id}"),
            PdfBlock(f"Exported At: {exported_at}", after=10),
            PdfBlock("Mission Summary", font="F2", size=13, leading=18, before=2, after=2),
        ]

        if summary_rows:
            for label, value in summary_rows:
                blocks.append(PdfBlock(f"{label}: {value}"))
        else:
            for paragraph in self._split_paragraphs(summary):
                blocks.append(PdfBlock(paragraph))
            blocks.append(PdfBlock("", after=4))
            blocks.append(PdfBlock("Submitted Details", font="F2", size=13, leading=18, before=2, after=2))

            if answer_rows:
                for row in answer_rows:
                    blocks.append(PdfBlock(f"{row['label']}: {row['value']}"))
            else:
                blocks.append(PdfBlock("No submitted answers were available for this export."))

        return blocks

    def _paginate(self, blocks: list[PdfBlock]) -> list[str]:
        page_width = 612
        page_height = 792
        top_margin = 56
        bottom_margin = 54
        right_margin = 54
        current_y = page_height - top_margin
        pages: list[list[str]] = [[]]

        for block in blocks:
            lines = self._wrap_lines(
                block.text,
                max_chars=block.max_chars or self._max_chars(page_width - block.x - right_margin, block.size),
            )
            required_height = block.before + (len(lines) * block.leading) + block.after
            if current_y - required_height < bottom_margin and pages[-1]:
                pages.append([])
                current_y = page_height - top_margin

            current_y -= block.before
            for line in lines:
                if line:
                    pages[-1].append(self._text_command(line, x=block.x, y=current_y, font=block.font, size=block.size))
                current_y -= block.leading
            current_y -= block.after

        return ["\n".join(page) for page in pages]

    def _build_pdf_document(self, page_commands: list[str]) -> bytes:
        objects: dict[int, bytes] = {
            1: b"<< /Type /Catalog /Pages 2 0 R >>",
            3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            4: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        }
        page_ids: list[int] = []
        next_id = 5

        for commands in page_commands:
            content_id = next_id
            page_id = next_id + 1
            next_id += 2
            content_bytes = commands.encode("latin-1", "replace")
            objects[content_id] = (
                f"<< /Length {len(content_bytes)} >>\nstream\n".encode("ascii")
                + content_bytes
                + b"\nendstream"
            )
            objects[page_id] = (
                f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
                f"/Contents {content_id} 0 R >>"
            ).encode("ascii")
            page_ids.append(page_id)

        kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
        objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("ascii")

        max_id = max(objects)
        output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = {0: 0}

        for object_id in range(1, max_id + 1):
            offsets[object_id] = len(output)
            output.extend(f"{object_id} 0 obj\n".encode("ascii"))
            output.extend(objects[object_id])
            output.extend(b"\nendobj\n")

        xref_start = len(output)
        output.extend(f"xref\n0 {max_id + 1}\n".encode("ascii"))
        output.extend(b"0000000000 65535 f \n")
        for object_id in range(1, max_id + 1):
            output.extend(f"{offsets[object_id]:010} 00000 n \n".encode("ascii"))
        output.extend(f"trailer\n<< /Size {max_id + 1} /Root 1 0 R >>\n".encode("ascii"))
        output.extend(f"startxref\n{xref_start}\n%%EOF".encode("ascii"))
        return bytes(output)

    def _build_submission_answer_rows(self, payload: Any) -> list[dict[str, str]]:
        if not isinstance(payload, dict):
            return []

        rows: list[dict[str, str]] = []
        seen: set[str] = set()

        def push_row(key: str, label: str, value: Any) -> None:
            row_key = str(key or "").strip().lower()
            if not row_key or row_key in seen:
                return
            text = self._format_answer_value(value)
            if not text:
                return
            seen.add(row_key)
            rows.append({"label": label or self._format_field_label(key), "value": text})

        push_row("service_type", "Service Type", payload.get("service_type"))

        captured_answers = payload.get("captured_answers")
        if isinstance(captured_answers, dict):
            for key, value in captured_answers.items():
                push_row(str(key), self._format_field_label(str(key)), value)
            return rows

        ordered_keys = (
            ("project_title", "Project Title"),
            ("goal", "Goal"),
            ("target_audience", "Target Audience"),
            ("primary_cta", "Primary CTA"),
            ("time_sensitivity", "Time Sensitivity"),
            ("due_date", "Due Date"),
            ("approver", "Approver"),
            ("required_elements", "Required Elements"),
            ("references", "References / Links"),
            ("uploaded_files", "Uploaded Files"),
            ("notes", "Notes"),
        )
        for key, label in ordered_keys:
            push_row(key, label, payload.get(key))

        branch_answers = payload.get("branch_answers")
        if isinstance(branch_answers, dict):
            for key, value in branch_answers.items():
                push_row(str(key), self._format_field_label(str(key)), value)

        return rows

    def _parse_summary_rows(self, summary: str) -> list[tuple[str, str]]:
        rows: list[tuple[str, str]] = []
        for raw_line in str(summary or "").replace("\r\n", "\n").split("\n"):
            line = raw_line.strip()
            if not line or line == "---" or line.lower().startswith(("http://", "https://")):
                continue
            matched = False
            for pattern in SUMMARY_PAIR_PATTERNS:
                match = pattern.match(line)
                if not match:
                    continue
                key = self._display_text(match.group(1), fallback="")
                value = self._display_text(match.group(2), fallback="")
                if not key or key.lower() in {"http", "https"}:
                    continue
                rows.append((key, value or "-"))
                matched = True
                break
            if not matched:
                return []
        return rows

    def _split_paragraphs(self, value: str) -> list[str]:
        paragraphs = [part.strip() for part in str(value or "").replace("\r\n", "\n").split("\n") if part.strip()]
        return paragraphs or ["Summary not available."]

    def _wrap_lines(self, text: str, *, max_chars: int) -> list[str]:
        normalized = self._ascii_text(text)
        if not normalized:
            return [""]
        lines: list[str] = []
        for raw_line in normalized.split("\n"):
            stripped = raw_line.strip()
            if not stripped:
                lines.append("")
                continue
            wrapped = textwrap.wrap(
                stripped,
                width=max_chars,
                break_long_words=True,
                break_on_hyphens=True,
            )
            lines.extend(wrapped or [""])
        return lines or [""]

    def _max_chars(self, width_points: int, font_size: int) -> int:
        return max(28, int(width_points / max(font_size * 0.55, 1)))

    def _text_command(self, text: str, *, x: int, y: int, font: str, size: int) -> str:
        escaped = self._escape_pdf_text(text)
        return f"BT /{font} {size} Tf 1 0 0 1 {x} {y} Tm ({escaped}) Tj ET"

    def _escape_pdf_text(self, value: str) -> str:
        return (
            self._ascii_text(value)
            .replace("\\", "\\\\")
            .replace("(", "\\(")
            .replace(")", "\\)")
        )

    def _display_text(self, value: Any, *, fallback: str) -> str:
        text = self._format_answer_value(value)
        return text or fallback

    def _format_answer_value(self, value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, list):
            parts = [self._ascii_text(item).strip() for item in value if self._ascii_text(item).strip()]
            return ", ".join(parts)
        if isinstance(value, dict):
            parts = []
            for key, nested_value in value.items():
                nested_text = self._format_answer_value(nested_value)
                if not nested_text:
                    continue
                parts.append(f"{self._format_field_label(str(key))}: {nested_text}")
            return " | ".join(parts)
        return self._ascii_text(value).strip()

    def _format_field_label(self, field_key: str) -> str:
        raw = self._ascii_text(field_key).strip()
        if not raw:
            return "Field"
        return re.sub(r"\s+", " ", re.sub(r"[_-]+", " ", raw)).strip().title()

    def _format_datetime(self, value: Any) -> str:
        if not value:
            return "-"
        if isinstance(value, datetime):
            parsed = value
        else:
            text = str(value).strip()
            if not text:
                return "-"
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return self._ascii_text(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    def _slugify(self, value: Any) -> str:
        text = self._ascii_text(value).lower()
        text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
        return text[:80]

    def _ascii_text(self, value: Any) -> str:
        text = str(value or "")
        normalized = unicodedata.normalize("NFKD", text)
        return normalized.encode("ascii", "ignore").decode("ascii")
