const VOICE_OUTPUT_STORAGE_KEY = "biabot-voice-output-enabled";
const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];
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

export function pickPreferredSpeechSynthesisVoice(voices) {
  const voiceList = Array.isArray(voices) ? voices : [];
  if (voiceList.length === 0) {
    return null;
  }

  return [...voiceList]
    .map((voice) => ({
      score: scoreSpeechSynthesisVoice(voice),
      voice,
    }))
    .sort((left, right) => right.score - left.score)[0]?.voice || null;
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

function scoreSpeechSynthesisVoice(voice) {
  const name = String(voice?.name ?? "").toLowerCase();
  const lang = String(voice?.lang ?? "").toLowerCase();
  let score = 0;

  if (lang.startsWith("en")) {
    score += 20;
  }
  if (voice?.localService) {
    score += 8;
  }
  if (voice?.default) {
    score += 4;
  }
  if (FEMALE_VOICE_HINTS.some((hint) => name.includes(hint))) {
    score += 100;
  }

  return score;
}
