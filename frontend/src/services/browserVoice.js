const VOICE_OUTPUT_STORAGE_KEY = "biabot-voice-output-enabled";
const VOICE_ID_STORAGE_KEY = "biabot-voice-id";
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function hasWindow() {
  return typeof window !== "undefined";
}

export function getStoredVoiceOutputEnabled() {
  if (!hasWindow()) {
    return false;
  }
  return window.localStorage.getItem(VOICE_OUTPUT_STORAGE_KEY) === "true";
}

export function setStoredVoiceOutputEnabled(enabled) {
  if (!hasWindow()) {
    return;
  }
  window.localStorage.setItem(VOICE_OUTPUT_STORAGE_KEY, enabled ? "true" : "false");
}

export function getStoredVoiceId() {
  if (!hasWindow()) {
    return "";
  }
  return window.localStorage.getItem(VOICE_ID_STORAGE_KEY) || "";
}

export function setStoredVoiceId(voiceId) {
  if (!hasWindow()) {
    return;
  }
  const normalizedVoiceId = String(voiceId ?? "").trim();
  if (!normalizedVoiceId) {
    window.localStorage.removeItem(VOICE_ID_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(VOICE_ID_STORAGE_KEY, normalizedVoiceId);
}

export function isVoiceInputSupported() {
  return Boolean(
    hasWindow() &&
      navigator.mediaDevices?.getUserMedia &&
      typeof window.MediaRecorder !== "undefined"
  );
}

export function isVoiceOutputSupported() {
  return Boolean(hasWindow() && typeof window.Audio !== "undefined");
}

export function pickSupportedRecordingMimeType() {
  if (!hasWindow() || typeof window.MediaRecorder === "undefined") {
    return "";
  }
  if (typeof window.MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  for (const mimeType of RECORDING_MIME_TYPES) {
    if (window.MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return "";
}

export function buildRecordingFilename(mimeType) {
  const normalizedType = String(mimeType ?? "").toLowerCase();
  if (normalizedType.includes("ogg")) {
    return "voice-input.ogg";
  }
  if (normalizedType.includes("mp4")) {
    return "voice-input.mp4";
  }
  return "voice-input.webm";
}

export function mergeComposerText(baseValue, transcriptValue) {
  const baseText = String(baseValue ?? "").trim();
  const transcriptText = String(transcriptValue ?? "").trim();

  if (!baseText) {
    return transcriptText;
  }
  if (!transcriptText) {
    return baseText;
  }
  return `${baseText} ${transcriptText}`;
}

export function normalizeTextForSpeech(text) {
  return String(text ?? "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[#>*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
