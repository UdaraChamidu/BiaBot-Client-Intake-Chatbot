import { apiClient } from "./apiClient";

function parseFilename(contentDisposition, fallback) {
  const header = String(contentDisposition ?? "").trim();
  if (!header) {
    return fallback;
  }

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/["']/g, "") || fallback;
    } catch {
      return fallback;
    }
  }

  const simpleMatch = header.match(/filename="?([^"]+)"?/i);
  if (!simpleMatch?.[1]) {
    return fallback;
  }
  return simpleMatch[1].trim() || fallback;
}

function triggerDownload(blob, filename) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
}

async function downloadPdf(config, fallbackFilename) {
  const response = await apiClient.request({
    responseType: "blob",
    ...config,
  });
  const filename = parseFilename(response.headers?.["content-disposition"], fallbackFilename);
  const blob = response.data instanceof Blob ? response.data : new Blob([response.data], { type: "application/pdf" });
  triggerDownload(blob, filename);
}

function toAscii(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "");
}

function slugify(value) {
  return toAscii(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatFieldLabel(fieldKey) {
  const raw = toAscii(fieldKey).trim();
  if (!raw) {
    return "Field";
  }
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatAnswerValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => toAscii(item).trim())
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, nested]) => {
        const nestedText = formatAnswerValue(nested);
        if (!nestedText) {
          return "";
        }
        return `${formatFieldLabel(key)}: ${nestedText}`;
      })
      .filter(Boolean)
      .join(" | ");
  }
  return toAscii(value).trim();
}

function buildSubmissionAnswerRows(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const rows = [];
  const seen = new Set();
  const pushRow = (key, label, value) => {
    const rowKey = String(key ?? "").trim().toLowerCase();
    if (!rowKey || seen.has(rowKey)) {
      return;
    }
    const text = formatAnswerValue(value);
    if (!text) {
      return;
    }
    seen.add(rowKey);
    rows.push({ label: label || formatFieldLabel(key), value: text });
  };

  pushRow("service_type", "Service Type", payload.service_type);

  if (payload.captured_answers && typeof payload.captured_answers === "object" && !Array.isArray(payload.captured_answers)) {
    for (const [key, value] of Object.entries(payload.captured_answers)) {
      pushRow(key, formatFieldLabel(key), value);
    }
    return rows;
  }

  const orderedKeys = [
    ["project_title", "Project Title"],
    ["goal", "Goal"],
    ["target_audience", "Target Audience"],
    ["primary_cta", "Primary CTA"],
    ["time_sensitivity", "Time Sensitivity"],
    ["due_date", "Due Date"],
    ["approver", "Approver"],
    ["required_elements", "Required Elements"],
    ["references", "References / Links"],
    ["uploaded_files", "Uploaded Files"],
    ["notes", "Notes"],
  ];
  for (const [key, label] of orderedKeys) {
    pushRow(key, label, payload[key]);
  }

  if (payload.branch_answers && typeof payload.branch_answers === "object" && !Array.isArray(payload.branch_answers)) {
    for (const [key, value] of Object.entries(payload.branch_answers)) {
      pushRow(key, formatFieldLabel(key), value);
    }
  }

  return rows;
}

function parseSummaryRows(summary) {
  const patterns = [
    /^\s*(?:[-*]\s+)?\*\*(.+?):\*\*\s*(.*)$/,
    /^\s*(?:[-*]\s+)?\*\*(.+?)\*\*\s*:\s*(.*)$/,
    /^\s*(?:[-*]\s+)?([^:\n]+?):\s*(.*)$/,
  ];

  const rows = [];
  for (const rawLine of String(summary ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line || line === "---" || /^https?:\/\//i.test(line)) {
      continue;
    }
    let matched = false;
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) {
        continue;
      }
      const key = formatAnswerValue(match[1]);
      const value = formatAnswerValue(match[2]) || "-";
      if (!key || ["http", "https"].includes(key.toLowerCase())) {
        continue;
      }
      rows.push([key, value]);
      matched = true;
      break;
    }
    if (!matched) {
      return [];
    }
  }
  return rows;
}

function splitParagraphs(value) {
  const paragraphs = toAscii(value)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
  return paragraphs.length ? paragraphs : ["Summary not available."];
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return formatAnswerValue(value) || "-";
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(
    2,
    "0"
  )} UTC`;
}

function escapePdfText(value) {
  return toAscii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLines(text, maxChars) {
  const normalized = toAscii(text);
  if (!normalized) {
    return [""];
  }

  const lines = [];
  for (const rawLine of normalized.split("\n")) {
    const stripped = rawLine.trim();
    if (!stripped) {
      lines.push("");
      continue;
    }
    let remaining = stripped;
    while (remaining.length > maxChars) {
      let breakAt = remaining.lastIndexOf(" ", maxChars);
      if (breakAt <= 0) {
        breakAt = maxChars;
      }
      lines.push(remaining.slice(0, breakAt).trim());
      remaining = remaining.slice(breakAt).trim();
    }
    lines.push(remaining);
  }
  return lines;
}

function textCommand(text, x, y, font, size) {
  return `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${escapePdfText(text)}) Tj ET`;
}

function buildPdfBytes(exportData) {
  const clientName = formatAnswerValue(exportData.client_name) || "Unknown Client";
  const clientCode = formatAnswerValue(exportData.client_code) || "-";
  const serviceType = formatAnswerValue(exportData.service_type) || "-";
  const projectTitle = formatAnswerValue(exportData.project_title) || "Untitled Request";
  const summary = toAscii(exportData.summary).replace(/\r\n/g, "\n").trim() || "Summary not available.";
  const summaryRows = parseSummaryRows(summary);
  const answerRows = buildSubmissionAnswerRows(exportData.payload);

  const blocks = [
    { text: `${clientName} Intake Summary`, font: "F2", size: 18, leading: 22, after: 4 },
    { text: "Bianomics client intake export", font: "F1", size: 10, leading: 13, after: 12 },
    { text: "Request Overview", font: "F2", size: 13, leading: 18, before: 2, after: 2 },
    { text: `Client Name: ${clientName}` },
    { text: `Client Code: ${clientCode}` },
    { text: `Service Type: ${serviceType}` },
    { text: `Project Title: ${projectTitle}` },
    { text: `Submission Date: ${formatDateTime(exportData.created_at)}` },
    { text: `Monday Item ID: ${formatAnswerValue(exportData.monday_item_id) || "-"}` },
    { text: `Exported At: ${formatDateTime(new Date().toISOString())}`, after: 10 },
    { text: "Mission Summary", font: "F2", size: 13, leading: 18, before: 2, after: 2 },
  ];

  if (summaryRows.length > 0) {
    for (const [label, value] of summaryRows) {
      blocks.push({ text: `${label}: ${value}` });
    }
  } else {
    for (const paragraph of splitParagraphs(summary)) {
      blocks.push({ text: paragraph });
    }
    blocks.push({ text: "", after: 4 });
    blocks.push({ text: "Submitted Details", font: "F2", size: 13, leading: 18, before: 2, after: 2 });
    if (answerRows.length > 0) {
      for (const row of answerRows) {
        blocks.push({ text: `${row.label}: ${row.value}` });
      }
    } else {
      blocks.push({ text: "No submitted answers were available for this export." });
    }
  }

  const pageWidth = 612;
  const pageHeight = 792;
  const topMargin = 56;
  const bottomMargin = 54;
  const rightMargin = 54;
  let currentY = pageHeight - topMargin;
  const pages = [[]];

  for (const block of blocks) {
    const font = block.font ?? "F1";
    const size = block.size ?? 11;
    const x = block.x ?? 54;
    const leading = block.leading ?? 15;
    const before = block.before ?? 0;
    const after = block.after ?? 0;
    const maxChars = Math.max(28, Math.floor((pageWidth - x - rightMargin) / Math.max(size * 0.55, 1)));
    const lines = wrapLines(block.text, maxChars);
    const requiredHeight = before + lines.length * leading + after;

    if (currentY - requiredHeight < bottomMargin && pages[pages.length - 1].length > 0) {
      pages.push([]);
      currentY = pageHeight - topMargin;
    }

    currentY -= before;
    for (const line of lines) {
      if (line) {
        pages[pages.length - 1].push(textCommand(line, x, currentY, font, size));
      }
      currentY -= leading;
    }
    currentY -= after;
  }

  const objects = new Map();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  let nextId = 5;
  const pageIds = [];
  for (const page of pages) {
    const contentId = nextId;
    const pageId = nextId + 1;
    nextId += 2;
    const content = page.join("\n");
    objects.set(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);

  const maxId = Math.max(...objects.keys());
  let output = "%PDF-1.4\n";
  const offsets = { 0: 0 };

  for (let objectId = 1; objectId <= maxId; objectId += 1) {
    offsets[objectId] = output.length;
    output += `${objectId} 0 obj\n${objects.get(objectId)}\nendobj\n`;
  }

  const xrefStart = output.length;
  output += `xref\n0 ${maxId + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let objectId = 1; objectId <= maxId; objectId += 1) {
    output += `${String(offsets[objectId]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return output;
}

function buildFilename(exportData) {
  const clientPart = slugify(exportData.client_name) || "client";
  const projectPart = slugify(exportData.project_title);
  if (projectPart) {
    return `${clientPart}-${projectPart}-intake-summary.pdf`;
  }
  return `${clientPart}-intake-summary.pdf`;
}

function downloadLocalPdf(exportData) {
  const pdfContent = buildPdfBytes(exportData);
  const blob = new Blob([pdfContent], { type: "application/pdf" });
  triggerDownload(blob, buildFilename(exportData));
}

export async function downloadClientSessionPdf(sessionId, summary) {
  await downloadPdf(
    {
      method: "post",
      url: `/chat/sessions/${encodeURIComponent(sessionId)}/pdf`,
      data: {
        summary: typeof summary === "string" ? summary : null,
      },
    },
    "client-intake-summary.pdf"
  );
}

export async function downloadAdminRequestPdf(_adminPassword, submission) {
  downloadLocalPdf({
    client_code: submission?.client_code ?? "",
    client_name: submission?.client_name ?? "",
    service_type: submission?.service_type ?? "",
    project_title: submission?.project_title ?? "",
    summary: submission?.summary ?? "",
    payload: submission?.payload ?? {},
    monday_item_id: submission?.monday_item_id ?? null,
    created_at: submission?.created_at ?? null,
  });
}
