const VOICE_OUTPUT_STORAGE_KEY = "biabot-voice-output-enabled";
const VOICE_URI_STORAGE_KEY = "biabot-preferred-voice-uri";
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];
const SPEECH_CHUNK_MAX_LENGTH = 180;
const FEMALE_VOICE_HINTS = [
  "female",
  "woman",
  "girl",
  "aria",
  "ava",
  "bella",
  "emma",
  "hazel",
  "jenny",
  "joanna",
  "kendra",
  "kimberly",
  "laura",
  "libby",
  "mia",
  "olivia",
  "rachel",
  "salli",
  "samantha",
  "sarah",
  "sofia",
  "sonia",
  "susan",
  "victoria",
  "zira",
];
const PRIORITY_FEMALE_VOICE_HINTS = [
  "jenny",
  "aria",
  "samantha",
  "sarah",
  "sonia",
  "ava",
  "bella",
  "zira",
];
const SPOKEN_TERM_OVERRIDES = [
  { pattern: /\bbianomics\b/gi, replacement: "Bee uh nomics" },
  { pattern: /\bbiabot\b/gi, replacement: "Bee uh Bot" },
  { pattern: /\bsupabase\b/gi, replacement: "Soo puh base" },
  { pattern: /\bdeepgram\b/gi, replacement: "Deep Gram" },
  { pattern: /\bopenai\b/gi, replacement: "Open A I" },
  { pattern: /\bmonday\.com\b/gi, replacement: "Monday dot com" },
  { pattern: /\bmonday\b/gi, replacement: "Monday" },
];
const SPELLED_OUT_ACRONYMS = [
  "AI",
  "API",
  "CRM",
  "FAQ",
  "JSON",
  "KPI",
  "LLM",
  "PDF",
  "SEO",
  "STT",
  "TTS",
  "UI",
  "URL",
  "UX",
];

function hasWindow() {
  return typeof window !== "undefined";
}

export function getStoredVoiceOutputEnabled() {
  if (!hasWindow()) {
    return false;
  }
  window.localStorage.removeItem(VOICE_OUTPUT_STORAGE_KEY);
  return false;
}

export function setStoredVoiceOutputEnabled(enabled) {
  if (!hasWindow()) {
    return;
  }
  window.localStorage.setItem(VOICE_OUTPUT_STORAGE_KEY, enabled ? "true" : "false");
}

export function isVoiceInputSupported() {
  return Boolean(
    hasWindow() &&
      navigator.mediaDevices?.getUserMedia &&
      typeof window.MediaRecorder !== "undefined"
  );
}

export function isVoiceOutputSupported() {
  return Boolean(
    hasWindow() &&
      typeof window.speechSynthesis !== "undefined" &&
      typeof window.SpeechSynthesisUtterance !== "undefined"
  );
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
  let normalized = String(text ?? "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/&/g, " and ")
    .replace(/%/g, " percent ")
    .replace(/\$/g, " dollars ")
    .replace(/#/g, " number ")
    .replace(/[>*_]/g, " ");

  for (const override of SPOKEN_TERM_OVERRIDES) {
    normalized = normalized.replace(override.pattern, override.replacement);
  }

  for (const acronym of SPELLED_OUT_ACRONYMS) {
    const pattern = new RegExp(`\\b${acronym}\\b`, "g");
    normalized = normalized.replace(pattern, acronym.split("").join(" "));
  }

  normalized = normalized.replace(/\b([A-Z]{2,}\d+[A-Z\d-]*)\b/g, (token) =>
    token.replace(/-/g, " ").split("").join(" ")
  );
  normalized = normalized.replace(/\b([A-Z]{3,})\b/g, (token) => {
    if (SPELLED_OUT_ACRONYMS.includes(token)) {
      return token.split("").join(" ");
    }
    return token;
  });

  return normalized.replace(/\s+/g, " ").trim();
}

export function pickPreferredSpeechSynthesisVoice(voices) {
  const voiceList = Array.isArray(voices) ? voices : [];
  if (voiceList.length === 0) {
    return null;
  }

  const storedVoiceUri = getStoredPreferredVoiceUri();
  const storedVoice = voiceList.find(
    (voice) => String(voice?.voiceURI ?? "").trim() === storedVoiceUri
  );
  if (storedVoice) {
    return storedVoice;
  }

  const selectedVoice =
    [...voiceList]
    .map((voice) => ({
      score: scoreSpeechSynthesisVoice(voice),
      voice,
    }))
    .sort((left, right) => right.score - left.score)[0]?.voice || null;

  if (selectedVoice) {
    setStoredPreferredVoiceUri(selectedVoice.voiceURI);
  }
  return selectedVoice;
}

export function waitForSpeechSynthesisVoices(timeoutMs = 3000) {
  if (!isVoiceOutputSupported()) {
    return Promise.resolve([]);
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    return Promise.resolve(voices);
  }

  return new Promise((resolve) => {
    let completed = false;

    function finish() {
      if (completed) {
        return;
      }
      completed = true;
      if (typeof window.speechSynthesis.removeEventListener === "function") {
        window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      }
      resolve(window.speechSynthesis.getVoices());
    }

    function handleVoicesChanged() {
      finish();
    }

    if (typeof window.speechSynthesis.addEventListener === "function") {
      window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
    }

    window.setTimeout(finish, timeoutMs);
  });
}

export function primeSpeechSynthesis() {
  if (!isVoiceOutputSupported()) {
    return;
  }

  try {
    const primer = new window.SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(primer);
    window.setTimeout(() => {
      window.speechSynthesis.cancel();
    }, 0);
  } catch {
    // Ignore browser-specific primer failures.
  }
}

export function splitTextForSpeech(text, maxLength = SPEECH_CHUNK_MAX_LENGTH) {
  const normalizedText = normalizeTextForSpeech(text);
  if (!normalizedText) {
    return [];
  }

  const sentenceCandidates = normalizedText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentenceCandidates.length === 0) {
    return [normalizedText];
  }

  const chunks = [];
  let currentChunk = "";

  function pushCurrentChunk() {
    const trimmedChunk = currentChunk.trim();
    if (trimmedChunk) {
      chunks.push(trimmedChunk);
    }
    currentChunk = "";
  }

  for (const sentence of sentenceCandidates) {
    if (sentence.length > maxLength) {
      pushCurrentChunk();
      chunks.push(...splitLongSpeechSegment(sentence, maxLength));
      continue;
    }

    const nextChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
    if (nextChunk.length > maxLength) {
      pushCurrentChunk();
      currentChunk = sentence;
      continue;
    }
    currentChunk = nextChunk;
  }

  pushCurrentChunk();
  return chunks.length > 0 ? chunks : [normalizedText];
}

function getStoredPreferredVoiceUri() {
  if (!hasWindow()) {
    return "";
  }
  return String(window.localStorage.getItem(VOICE_URI_STORAGE_KEY) || "").trim();
}

function setStoredPreferredVoiceUri(voiceUri) {
  if (!hasWindow()) {
    return;
  }
  const normalizedVoiceUri = String(voiceUri ?? "").trim();
  if (!normalizedVoiceUri) {
    window.localStorage.removeItem(VOICE_URI_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(VOICE_URI_STORAGE_KEY, normalizedVoiceUri);
}

function splitLongSpeechSegment(segment, maxLength) {
  const phraseCandidates = segment
    .split(/(?<=[,;:])\s+/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);

  if (phraseCandidates.length <= 1) {
    return splitSpeechChunkByWords(segment, maxLength);
  }

  const chunks = [];
  let currentChunk = "";

  for (const phrase of phraseCandidates) {
    const nextChunk = currentChunk ? `${currentChunk} ${phrase}` : phrase;
    if (nextChunk.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }
      if (phrase.length > maxLength) {
        chunks.push(...splitSpeechChunkByWords(phrase, maxLength));
      } else {
        currentChunk = phrase;
      }
      continue;
    }
    currentChunk = nextChunk;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitSpeechChunkByWords(text, maxLength) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let currentChunk = "";

  for (const word of words) {
    const nextChunk = currentChunk ? `${currentChunk} ${word}` : word;
    if (nextChunk.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = word;
      continue;
    }
    currentChunk = nextChunk;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function scoreSpeechSynthesisVoice(voice) {
  const name = String(voice?.name ?? "").toLowerCase();
  const voiceUri = String(voice?.voiceURI ?? "").toLowerCase();
  const lang = String(voice?.lang ?? "").toLowerCase();
  let score = 0;

  if (lang.startsWith("en-us")) {
    score += 28;
  } else if (lang.startsWith("en-gb")) {
    score += 24;
  } else if (lang.startsWith("en")) {
    score += 20;
  }
  if (lang.startsWith("en")) {
    score += 6;
  }
  if (voice?.localService) {
    score += 8;
  }
  if (voice?.default) {
    score += 4;
  }
  if (voiceUri.includes("natural")) {
    score += 10;
  }
  if (voiceUri.includes("online")) {
    score += 6;
  }
  if (PRIORITY_FEMALE_VOICE_HINTS.some((hint) => name.includes(hint) || voiceUri.includes(hint))) {
    score += 40;
  }
  if (FEMALE_VOICE_HINTS.some((hint) => name.includes(hint))) {
    score += 100;
  }

  return score;
}
