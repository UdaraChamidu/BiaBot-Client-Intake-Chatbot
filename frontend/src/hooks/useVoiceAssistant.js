import { useEffect, useMemo, useRef, useState } from "react";

import {
  getStoredVoiceId,
  getStoredVoiceOutputEnabled,
  isVoiceInputSupported as browserSupportsVoiceInput,
  isVoiceOutputSupported as browserSupportsVoiceOutput,
  mergeComposerText,
  pickSupportedRecordingMimeType,
  setStoredVoiceId,
  setStoredVoiceOutputEnabled,
} from "../services/browserVoice";
import {
  fetchVoiceCatalog,
  synthesizeVoiceAudio,
  transcribeVoiceRecording,
} from "../services/voiceService";

const VOICE_INPUT_UNSUPPORTED_MESSAGE =
  "Voice input is not supported in this browser. Use a recent Chrome or Edge build.";
const VOICE_INPUT_PERMISSION_MESSAGE =
  "Microphone access could not be started. Check browser permissions and try again.";
const PREVIEW_TRANSCRIPTION_INTERVAL_MS = 1000;
const RECORDING_CHUNK_TIMESLICE_MS = 650;

function isCanceledError(error) {
  return error?.code === "ERR_CANCELED" || error?.name === "CanceledError";
}

function normalizeTranscript(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function getApiErrorMessage(error, fallbackMessage) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  if (typeof error?.message === "string" && error.message.trim() && !isCanceledError(error)) {
    return error.message.trim();
  }
  return fallbackMessage;
}

function isPlaybackInterruptionError(error) {
  const errorName = String(error?.name ?? "").trim();
  const errorMessage = String(error?.message ?? "").trim().toLowerCase();
  return (
    errorName === "AbortError" ||
    errorMessage.includes("interrupted by a call to pause") ||
    errorMessage.includes("interrupted by a new load request")
  );
}

function stopMediaStream(stream) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function getMicrophoneErrorMessage(error) {
  const errorName = String(error?.name ?? "").trim();
  if (errorName === "NotAllowedError" || errorName === "SecurityError") {
    return VOICE_INPUT_PERMISSION_MESSAGE;
  }
  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "No microphone was found on this device.";
  }
  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "Your microphone is busy in another app. Close that app and try again.";
  }
  if (errorName === "OverconstrainedError") {
    return "The selected microphone does not support the requested audio settings.";
  }
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return VOICE_INPUT_PERMISSION_MESSAGE;
}

export function useVoiceAssistant({
  latestBotMessage,
  getCurrentInputValue,
  onInputValueChange,
}) {
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelRecordingRef = useRef(false);
  const baseInputValueRef = useRef("");
  const previewTranscriptRef = useRef("");
  const lastInjectedInputValueRef = useRef("");
  const audioElementRef = useRef(null);
  const audioObjectUrlRef = useRef("");
  const lastSpokenMessageIdRef = useRef("");
  const voicesAbortControllerRef = useRef(null);
  const previewAbortControllerRef = useRef(null);
  const transcriptionAbortControllerRef = useRef(null);
  const synthesisAbortControllerRef = useRef(null);
  const previewRequestInFlightRef = useRef(false);
  const previewRequestQueuedRef = useRef(false);
  const lastPreviewRequestedAtRef = useRef(0);
  const getCurrentInputValueRef = useRef(getCurrentInputValue);
  const onInputValueChangeRef = useRef(onInputValueChange);

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [voiceCatalogError, setVoiceCatalogError] = useState("");
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceId, setSelectedVoiceIdState] = useState(() => getStoredVoiceId());
  const [isVoiceOutputEnabled, setIsVoiceOutputEnabledState] = useState(() =>
    browserSupportsVoiceOutput() && getStoredVoiceOutputEnabled()
  );

  const isVoiceInputSupported = browserSupportsVoiceInput();
  const isVoiceOutputSupported = browserSupportsVoiceOutput();

  useEffect(() => {
    getCurrentInputValueRef.current = getCurrentInputValue;
  }, [getCurrentInputValue]);

  useEffect(() => {
    onInputValueChangeRef.current = onInputValueChange;
  }, [onInputValueChange]);

  function clearAudioPlayback() {
    if (audioElementRef.current) {
      audioElementRef.current.onended = null;
      audioElementRef.current.onerror = null;
      audioElementRef.current.pause();
      audioElementRef.current.removeAttribute("src");
      audioElementRef.current.load?.();
      audioElementRef.current = null;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = "";
    }
  }

  function stopSpeaking() {
    if (synthesisAbortControllerRef.current) {
      synthesisAbortControllerRef.current.abort();
      synthesisAbortControllerRef.current = null;
    }
    clearAudioPlayback();
    setIsSpeaking(false);
  }

  function abortPendingTranscription() {
    if (transcriptionAbortControllerRef.current) {
      transcriptionAbortControllerRef.current.abort();
      transcriptionAbortControllerRef.current = null;
    }
    setIsTranscribing(false);
  }

  function abortPreviewTranscription() {
    if (previewAbortControllerRef.current) {
      previewAbortControllerRef.current.abort();
      previewAbortControllerRef.current = null;
    }
    previewRequestInFlightRef.current = false;
    previewRequestQueuedRef.current = false;
  }

  function applySpeechTranscriptToInput(transcript) {
    const mergedValue = mergeComposerText(baseInputValueRef.current, transcript);
    lastInjectedInputValueRef.current = mergedValue;
    onInputValueChangeRef.current?.(mergedValue);
    return mergedValue;
  }

  async function runPreviewTranscription() {
    if (!chunksRef.current.length) {
      return;
    }

    const previewBlob = new Blob(chunksRef.current, {
      type: chunksRef.current[0]?.type || pickSupportedRecordingMimeType() || "audio/webm",
    });
    if (!previewBlob.size) {
      return;
    }

    previewRequestInFlightRef.current = true;
    previewRequestQueuedRef.current = false;
    lastPreviewRequestedAtRef.current = Date.now();

    const previewController = new AbortController();
    previewAbortControllerRef.current = previewController;

    try {
      const result = await transcribeVoiceRecording(previewBlob, {
        preview: true,
        signal: previewController.signal,
      });
      const transcript = normalizeTranscript(result?.transcript);
      if (transcript && recorderRef.current?.state === "recording") {
        previewTranscriptRef.current = transcript;
        applySpeechTranscriptToInput(transcript);
      }
    } catch (error) {
      if (!isCanceledError(error)) {
        previewTranscriptRef.current = "";
      }
    } finally {
      if (previewAbortControllerRef.current === previewController) {
        previewAbortControllerRef.current = null;
      }
      previewRequestInFlightRef.current = false;

      if (
        previewRequestQueuedRef.current &&
        recorderRef.current?.state === "recording"
      ) {
        previewRequestQueuedRef.current = false;
        void queuePreviewTranscription(true);
      }
    }
  }

  async function queuePreviewTranscription(force = false) {
    if (!recorderRef.current || recorderRef.current.state !== "recording") {
      return;
    }
    if (previewRequestInFlightRef.current) {
      previewRequestQueuedRef.current = true;
      return;
    }

    const elapsedSinceLastPreview = Date.now() - lastPreviewRequestedAtRef.current;
    if (!force && elapsedSinceLastPreview < PREVIEW_TRANSCRIPTION_INTERVAL_MS) {
      previewRequestQueuedRef.current = true;
      return;
    }

    void runPreviewTranscription();
  }

  function stopRecording() {
    cancelRecordingRef.current = true;
    abortPreviewTranscription();
    abortPendingTranscription();
    previewTranscriptRef.current = "";
    lastInjectedInputValueRef.current = "";

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {
        // Ignore browser stop errors and clean up below.
      }
    }

    stopMediaStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
  }

  async function finishRecording() {
    if (!recorderRef.current || recorderRef.current.state === "inactive") {
      setIsRecording(false);
      return;
    }

    cancelRecordingRef.current = false;
    setIsRecording(false);
    try {
      recorderRef.current.stop();
    } catch {
      stopRecording();
      setVoiceError("Voice recording could not be completed. Please try again.");
    }
  }

  async function handleRecorderStop() {
    const shouldCancel = cancelRecordingRef.current;
    const recordedChunks = [...chunksRef.current];

    abortPreviewTranscription();
    chunksRef.current = [];
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;

    if (shouldCancel) {
      cancelRecordingRef.current = false;
      return;
    }

    if (recordedChunks.length === 0) {
      setVoiceError("No speech was captured. Try again and speak after the microphone turns on.");
      return;
    }

    const recordingMimeType =
      recordedChunks[0]?.type || pickSupportedRecordingMimeType() || "audio/webm";
    const audioBlob = new Blob(recordedChunks, { type: recordingMimeType });
    if (!audioBlob.size) {
      setVoiceError("No speech was captured. Try again and speak after the microphone turns on.");
      return;
    }

    const transcriptionController = new AbortController();
    transcriptionAbortControllerRef.current = transcriptionController;
    setIsTranscribing(true);
    setVoiceError("");

    try {
      const result = await transcribeVoiceRecording(audioBlob, {
        signal: transcriptionController.signal,
      });
      const transcript = normalizeTranscript(result?.transcript);
      if (!transcript) {
        setVoiceError("No speech was detected in that recording. Please try again.");
        return;
      }

      const previewSnapshot = previewTranscriptRef.current;
      previewTranscriptRef.current = transcript;
      const currentInputValue = getCurrentInputValueRef.current?.() ?? "";
      const expectedPreviewValue = mergeComposerText(
        baseInputValueRef.current,
        previewSnapshot
      );
      const canReplacePreviewValue =
        currentInputValue === expectedPreviewValue ||
        currentInputValue === lastInjectedInputValueRef.current;

      if (canReplacePreviewValue) {
        applySpeechTranscriptToInput(transcript);
      } else if (!previewSnapshot) {
        const mergedCurrentValue = mergeComposerText(currentInputValue, transcript);
        lastInjectedInputValueRef.current = mergedCurrentValue;
        onInputValueChangeRef.current?.(mergedCurrentValue);
      }
    } catch (error) {
      if (!isCanceledError(error)) {
        const fallbackPreview = normalizeTranscript(previewTranscriptRef.current);
        if (!fallbackPreview) {
          setVoiceError(
            getApiErrorMessage(error, "Voice transcription failed. Please try again.")
          );
        }
      }
    } finally {
      if (transcriptionAbortControllerRef.current === transcriptionController) {
        transcriptionAbortControllerRef.current = null;
      }
      setIsTranscribing(false);
    }
  }

  async function startRecording() {
    if (!isVoiceInputSupported) {
      setVoiceError(VOICE_INPUT_UNSUPPORTED_MESSAGE);
      return;
    }

    stopSpeaking();
    abortPendingTranscription();
    setVoiceError("");
    baseInputValueRef.current = getCurrentInputValueRef.current?.() ?? "";
    cancelRecordingRef.current = false;
    previewTranscriptRef.current = "";
    lastInjectedInputValueRef.current = "";
    previewRequestQueuedRef.current = false;
    previewRequestInFlightRef.current = false;
    lastPreviewRequestedAtRef.current = 0;
    let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = pickSupportedRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          chunksRef.current.push(event.data);
          if (recorder.state === "recording") {
            void queuePreviewTranscription();
          }
        }
      };
      recorder.onstop = () => {
        void handleRecorderStop();
      };
      recorder.onerror = (event) => {
        abortPreviewTranscription();
        abortPendingTranscription();
        stopMediaStream(streamRef.current);
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];
        setIsRecording(false);
        const recorderMessage = getMicrophoneErrorMessage(event?.error);
        setVoiceError(recorderMessage || "Voice recording failed. Please try again.");
      };

      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start(RECORDING_CHUNK_TIMESLICE_MS);
      setIsRecording(true);
    } catch (error) {
      stopMediaStream(stream);
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      setIsRecording(false);
      setVoiceError(getMicrophoneErrorMessage(error));
    }
  }

  function toggleRecording() {
    if (isRecording) {
      void finishRecording();
      return;
    }
    void startRecording();
  }

  function cancelPendingVoiceTranscription() {
    abortPreviewTranscription();
    abortPendingTranscription();
  }

  function setVoiceOutputEnabled(enabled) {
    if (!enabled) {
      setStoredVoiceOutputEnabled(false);
      setIsVoiceOutputEnabledState(false);
      stopSpeaking();
      return;
    }

    if (!isVoiceOutputSupported) {
      setVoiceError("Audio playback is not supported in this browser.");
      setStoredVoiceOutputEnabled(false);
      setIsVoiceOutputEnabledState(false);
      return;
    }

    if (!selectedVoiceId) {
      setVoiceError("No ElevenLabs voice is available yet. Check your backend configuration.");
      setStoredVoiceOutputEnabled(false);
      setIsVoiceOutputEnabledState(false);
      return;
    }

    setStoredVoiceOutputEnabled(true);
    setIsVoiceOutputEnabledState(true);
    lastSpokenMessageIdRef.current = "";
    setVoiceError("");
  }

  function selectVoice(voiceId) {
    const normalizedVoiceId = String(voiceId ?? "").trim();
    setStoredVoiceId(normalizedVoiceId);
    setSelectedVoiceIdState(normalizedVoiceId);
    lastSpokenMessageIdRef.current = "";
  }

  useEffect(() => {
    if (!isVoiceOutputSupported) {
      return;
    }

    const controller = new AbortController();
    voicesAbortControllerRef.current = controller;
    setIsLoadingVoices(true);

    void fetchVoiceCatalog({ signal: controller.signal })
      .then((catalog) => {
        const voices = Array.isArray(catalog?.voices) ? catalog.voices : [];
        setAvailableVoices(voices);
        setVoiceCatalogError("");

        const storedVoiceId = getStoredVoiceId();
        const defaultVoiceId = String(catalog?.default_voice_id ?? "").trim();
        const nextVoiceId =
          voices.find((voice) => voice.voice_id === storedVoiceId)?.voice_id ||
          voices.find((voice) => voice.voice_id === selectedVoiceId)?.voice_id ||
          defaultVoiceId ||
          voices[0]?.voice_id ||
          "";

        setSelectedVoiceIdState(nextVoiceId);
        setStoredVoiceId(nextVoiceId);

        if (!nextVoiceId && isVoiceOutputEnabled) {
          setIsVoiceOutputEnabledState(false);
          setStoredVoiceOutputEnabled(false);
        }
      })
      .catch((error) => {
        if (isCanceledError(error)) {
          return;
        }
        setAvailableVoices([]);
        setSelectedVoiceIdState("");
        setStoredVoiceId("");
        setVoiceCatalogError(
          getApiErrorMessage(
            error,
            "AI voices are unavailable until ElevenLabs is configured."
          )
        );
        if (isVoiceOutputEnabled) {
          setIsVoiceOutputEnabledState(false);
          setStoredVoiceOutputEnabled(false);
        }
      })
      .finally(() => {
        if (voicesAbortControllerRef.current === controller) {
          voicesAbortControllerRef.current = null;
        }
        setIsLoadingVoices(false);
      });
  }, [isVoiceOutputSupported]);

  useEffect(() => {
    if (!isVoiceOutputEnabled || !isVoiceOutputSupported || !selectedVoiceId) {
      return;
    }

    if (!latestBotMessage?.id || latestBotMessage.role !== "bot") {
      return;
    }

    if (lastSpokenMessageIdRef.current === latestBotMessage.id) {
      return;
    }

    lastSpokenMessageIdRef.current = latestBotMessage.id;
    stopSpeaking();

    const controller = new AbortController();
    synthesisAbortControllerRef.current = controller;

    void synthesizeVoiceAudio(
      {
        text: latestBotMessage.text,
        voiceId: selectedVoiceId,
      },
      { signal: controller.signal }
    )
      .then(async ({ audioBlob }) => {
        if (controller.signal.aborted) {
          return;
        }

        clearAudioPlayback();
        const objectUrl = URL.createObjectURL(audioBlob);
        audioObjectUrlRef.current = objectUrl;

        const audio = new Audio(objectUrl);
        audioElementRef.current = audio;
        audio.onended = () => {
          if (audioElementRef.current !== audio) {
            return;
          }
          setIsSpeaking(false);
        };
        audio.onerror = () => {
          if (audioElementRef.current !== audio) {
            return;
          }
          setIsSpeaking(false);
          clearAudioPlayback();
          setVoiceError("AI voice playback failed. You can continue reading the text reply.");
        };

        setIsSpeaking(true);
        await audio.play();
      })
      .catch((error) => {
        if (isCanceledError(error) || isPlaybackInterruptionError(error)) {
          return;
        }
        clearAudioPlayback();
        setIsSpeaking(false);
        setVoiceError(
          getApiErrorMessage(
            error,
            "AI voice playback failed. You can continue reading the text reply."
          )
        );
      });
  }, [isVoiceOutputEnabled, isVoiceOutputSupported, latestBotMessage, selectedVoiceId]);

  useEffect(
    () => () => {
      if (voicesAbortControllerRef.current) {
        voicesAbortControllerRef.current.abort();
        voicesAbortControllerRef.current = null;
      }
      if (previewAbortControllerRef.current) {
        previewAbortControllerRef.current.abort();
        previewAbortControllerRef.current = null;
      }
      if (transcriptionAbortControllerRef.current) {
        transcriptionAbortControllerRef.current.abort();
        transcriptionAbortControllerRef.current = null;
      }
      if (synthesisAbortControllerRef.current) {
        synthesisAbortControllerRef.current.abort();
        synthesisAbortControllerRef.current = null;
      }
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          // Ignore shutdown races from the browser recorder.
        }
      }
      stopMediaStream(streamRef.current);
      streamRef.current = null;
      recorderRef.current = null;
      clearAudioPlayback();
    },
    []
  );

  const selectedVoice = useMemo(
    () => availableVoices.find((voice) => voice.voice_id === selectedVoiceId) || null,
    [availableVoices, selectedVoiceId]
  );

  return {
    availableVoices,
    clearVoiceError: () => setVoiceError(""),
    isLoadingVoices,
    isRecording,
    isSpeaking,
    isTranscribing,
    isVoiceInputSupported,
    isVoiceOutputEnabled,
    isVoiceOutputSupported,
    cancelPendingVoiceTranscription,
    selectedVoice,
    selectedVoiceId,
    setSelectedVoiceId: selectVoice,
    setVoiceOutputEnabled,
    stopRecording,
    stopSpeaking,
    toggleRecording,
    voiceCatalogError,
    voiceError,
  };
}
