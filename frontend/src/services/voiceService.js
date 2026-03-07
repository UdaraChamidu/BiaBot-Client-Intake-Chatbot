import { apiClient } from "./apiClient";
import {
  buildRecordingFilename,
  normalizeTextForSpeech,
} from "./browserVoice";

export async function fetchVoiceCatalog({ signal } = {}) {
  const { data } = await apiClient.get("/voice/voices", {
    signal,
    timeout: 30000,
  });
  return data;
}

export async function transcribeVoiceRecording(
  audioBlob,
  { signal, preview = false } = {}
) {
  const formData = new FormData();
  formData.append("audio", audioBlob, buildRecordingFilename(audioBlob.type));

  const { data } = await apiClient.post("/voice/stt", formData, {
    params: preview ? { preview: "true" } : undefined,
    signal,
    timeout: 90000,
  });
  return data;
}

export async function synthesizeVoiceAudio(
  { text, voiceId, modelId },
  { signal } = {}
) {
  const payload = {
    text: normalizeTextForSpeech(text),
    voice_id: voiceId || null,
    model_id: modelId || null,
  };

  const response = await apiClient.post("/voice/tts", payload, {
    responseType: "blob",
    signal,
    timeout: 90000,
  });

  return {
    audioBlob: response.data,
    mediaType:
      response.headers["content-type"] || response.data?.type || "audio/mpeg",
  };
}
