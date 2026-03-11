import { apiClient } from "./apiClient";
import { buildRecordingFilename } from "./browserVoice";

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
