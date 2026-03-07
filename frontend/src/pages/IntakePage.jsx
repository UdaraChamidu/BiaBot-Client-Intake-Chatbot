import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

import { useVoiceAssistant } from "../hooks/useVoiceAssistant";
import { sendChatMessage } from "../services/intakeService";
import { getStoredTheme, toggleTheme } from "../utils/theme";

const BOT_AVATAR_URL = "/avatar.png";
const TEST_SUMMARY_TEMPLATE = `**Client Name:** Udara Herath
**Client Code:** C0001
**Service Type:** Press Release
**Project Title:** Title 01
**Goal (desired outcome):** Generate media coverage and qualified awareness.
**Target Audience:** B2B decision makers
**Primary CTA:** Visit the landing page
**Time Sensitivity:** Soon
**Due Date:** 2026-02-03
**Approver:** 
**Required elements (logos, disclaimers, QR codes, etc.):** Product specs, pricing table, legal disclaimer
**References / links (comma-separated):** https://example.com/launch, https://example.com/media-kit
**Announcement summary:** Product launch in Colombo for enterprise users.
**Quotes needed?:** Yes
**Boilerplate inclusion:** Yes
**Media targets:** Regional tech and business outlets
**Assets needed:** 
**Any files to attach? Share filenames or links.:** `;

function messageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function makeMessage(role, text) {
  return { id: messageId(), role, text };
}

function composerPlaceholder(phase) {
  if (phase === "await_client_code") {
    return "Let's get you into your workspace. Enter your client code below.";
  }
  if (phase === "await_confirmation") {
    return "Confirm submission or request a restart";
  }
  return "Type your message...";
}

function getUserInitials(profile) {
  const name = profile?.client_name;
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name[0].toUpperCase();
}

function displayText(value, fallback = "Not set") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

const SUMMARY_PAIR_PATTERNS = [
  {
    style: "bold_colon_inside",
    regex: /^(\s*(?:[-*]\s+)?)\*\*(.+?):\*\*\s*(.*)$/,
  },
  {
    style: "bold_colon_outside",
    regex: /^(\s*(?:[-*]\s+)?)\*\*(.+?)\*\*\s*:\s*(.*)$/,
  },
  {
    style: "plain",
    regex: /^(\s*(?:[-*]\s+)?)([^:\n]+?):\s*(.*)$/,
  },
];

function isLikelySummaryKey(key) {
  const cleaned = String(key ?? "").trim();
  if (!cleaned || cleaned.length > 64) {
    return false;
  }
  if (/https?:\/\//i.test(cleaned) || /^[\W_]+$/.test(cleaned)) {
    return false;
  }
  const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8) {
    return false;
  }
  return /^[A-Za-z0-9][A-Za-z0-9()\/&+,_.'? -]*$/.test(cleaned);
}

function parseSummaryLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "---" || /^https?:\/\//i.test(trimmed)) {
    return null;
  }

  for (const pattern of SUMMARY_PAIR_PATTERNS) {
    const match = line.match(pattern.regex);
    if (!match) {
      continue;
    }
    const key = String(match[2] ?? "").trim();
    if (["http", "https"].includes(key.toLowerCase())) {
      continue;
    }
    if (!isLikelySummaryKey(key)) {
      continue;
    }
    return {
      type: "pair",
      style: pattern.style,
      leading: match[1] ?? "",
      key,
      value: match[3] ?? "",
    };
  }
  return null;
}

function parseSummarySegments(summaryText) {
  const normalized = String(summaryText ?? "").replace(/\r\n/g, "\n");
  const segments = normalized.split("\n").map((line) => {
    const pair = parseSummaryLine(line);
    if (pair) {
      return pair;
    }
    return { type: "text", text: line };
  });
  const editableCount = segments.filter((segment) => segment.type === "pair").length;
  return { segments, editableCount };
}

function stringifySummarySegments(segments) {
  return segments
    .map((segment) => {
      if (segment.type !== "pair") {
        return segment.text;
      }
      const valuePart = segment.value ? ` ${segment.value}` : "";
      if (segment.style === "bold_colon_inside") {
        return `${segment.leading}**${segment.key}:**${valuePart}`;
      }
      if (segment.style === "bold_colon_outside") {
        return `${segment.leading}**${segment.key}**:${valuePart}`;
      }
      return `${segment.leading}${segment.key}:${valuePart}`;
    })
    .join("\n");
}

export default function IntakePage() {
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [phase, setPhase] = useState("await_client_code");
  const [sessionId, setSessionId] = useState("");
  const [profile, setProfile] = useState(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.innerWidth >= 900;
  });
  const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(false);
  const [welcomeNotice, setWelcomeNotice] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [currentTheme, setCurrentTheme] = useState(getStoredTheme());
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summarySource, setSummarySource] = useState("");
  const [isSummaryPreviewMode, setIsSummaryPreviewMode] = useState(false);

  const chatWindowRef = useRef(null);
  const inputRef = useRef(null);
  const tailRef = useRef(null);
  const welcomeTimeoutRef = useRef(null);
  const lastWelcomedClientCodeRef = useRef("");
  const parsedSummary = useMemo(() => parseSummarySegments(summaryDraft), [summaryDraft]);
  const hasStructuredSummary = parsedSummary.editableCount > 0;
  const latestBotMessage = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "bot") {
        return messages[index];
      }
    }
    return null;
  }, [messages]);
  const {
    availableVoices,
    cancelPendingVoiceTranscription,
    clearVoiceError,
    isLoadingVoices,
    isRecording,
    isSpeaking,
    isTranscribing,
    isVoiceInputSupported,
    isVoiceOutputEnabled,
    isVoiceOutputSupported,
    selectedVoice,
    selectedVoiceId,
    setVoiceOutputEnabled,
    stopRecording,
    stopSpeaking,
    toggleRecording,
    voiceCatalogError,
    voiceError,
  } = useVoiceAssistant({
    latestBotMessage,
    getCurrentInputValue: () => inputValue,
    onInputValueChange: setInputValue,
  });
  const voiceStatusMessage = voiceError
    ? voiceError
    : isTranscribing
      ? "Refining the transcript in the background. You can edit or send now."
    : isRecording
      ? "Listening. Click the mic again when you are done speaking."
      : isSpeaking && isVoiceOutputEnabled
        ? `AI voice is playing${selectedVoice?.name ? ` using ${selectedVoice.name}` : ""}. Start recording to interrupt playback.`
        : "";
  const voiceStatusClassName = voiceError
    ? "error-banner voice-status-banner"
    : isTranscribing
      ? "status-banner voice-status-banner"
    : isRecording
      ? "banner-warning voice-status-banner"
      : "status-banner voice-status-banner";
  const canEnableVoiceOutput =
    isVoiceOutputSupported &&
    !isLoadingVoices &&
    Boolean(selectedVoiceId) &&
    availableVoices.length > 0;
  const voiceToolbarNote = voiceCatalogError
    ? voiceCatalogError
    : !isVoiceOutputSupported
      ? "Text chat still works here, but this browser cannot play AI voice replies."
    : isLoadingVoices
      ? "Loading AI voices from ElevenLabs..."
      : availableVoices.length > 0
        ? "Use the mic to fill the composer. Turn on AI Voice if you want spoken replies."
        : "No ElevenLabs voices are available for this workspace yet.";

  function pushBotMessage(text) {
    setMessages((prev) => [...prev, makeMessage("bot", text)]);
  }

  function pushUserMessage(text) {
    setMessages((prev) => [...prev, makeMessage("user", text)]);
    setSuggestions([]);
  }

  function hydrateFromResponse(response, { resetMessages = false } = {}) {
    const botText = response?.assistant_message || "I could not generate a response.";
    const nextSuggestions = response?.suggestions ?? [];
    const nextProfile = response?.profile ?? null;
    const nextPhase = response?.phase ?? "await_client_code";
    const nextSessionId = response?.session_id ?? sessionId;

    setSessionId(nextSessionId);
    setPhase(nextPhase);
    setSuggestions(nextSuggestions);
    setProfile(nextProfile);
    if (response?.ready_to_submit && typeof response?.summary === "string") {
      setIsSummaryPreviewMode(false);
      setSummarySource(response.summary);
      setSummaryDraft(response.summary);
    } else if (nextPhase !== "await_confirmation") {
      setIsSummaryPreviewMode(false);
      setSummarySource("");
      setSummaryDraft("");
    }

    if (resetMessages) {
      setMessages([makeMessage("bot", botText)]);
      return;
    }
    pushBotMessage(botText);
  }

  async function initializeChat() {
    setIsBusy(true);
    try {
      const response = await sendChatMessage({
        session_id: sessionId || null,
        message: "",
      });
      hydrateFromResponse(response, { resetMessages: true });
    } catch {
      setMessages([
        makeMessage(
          "bot",
          "I could not connect to the assistant service. Please check backend API status."
        ),
      ]);
      setSuggestions([]);
    } finally {
      setIsBusy(false);
    }
  }

  async function startNewChat() {
    stopRecording();
    stopSpeaking();
    clearVoiceError();
    setIsProfilePanelOpen(false);
    setInputValue("");
    setIsSummaryPreviewMode(false);
    setIsBusy(true);
    try {
      const response = await sendChatMessage({
        session_id: sessionId || null,
        message: "",
        reset: true,
      });
      hydrateFromResponse(response, { resetMessages: true });
    } catch {
      setMessages([
        makeMessage(
          "bot",
          "Unable to start a new chat right now. Please retry in a moment."
        ),
      ]);
      setSuggestions([]);
    } finally {
      setIsBusy(false);
    }
  }

  async function submitMessage(rawText) {
    const text = rawText.trim();
    if (!text || isBusy || isRecording) {
      return false;
    }

    cancelPendingVoiceTranscription();
    stopSpeaking();
    clearVoiceError();
    pushUserMessage(text);
    setIsBusy(true);
    try {
      const response = await sendChatMessage({
        session_id: sessionId || null,
        message: text,
      });
      hydrateFromResponse(response);
      return true;
    } catch {
      pushBotMessage("I could not process that message right now. Please try again.");
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function onComposerSubmit(event) {
    event.preventDefault();
    const text = inputValue;
    setInputValue("");
    await submitMessage(text);
  }

  async function onSuggestionClick(option) {
    stopRecording();
    stopSpeaking();
    clearVoiceError();
    await submitMessage(option);
  }

  function handleComposerChange(event) {
    setInputValue(event.target.value);
    if (voiceError) {
      clearVoiceError();
    }
  }

  function handleVoiceInputToggle() {
    clearVoiceError();
    toggleRecording();
  }

  function handleVoiceOutputToggle() {
    clearVoiceError();
    setVoiceOutputEnabled(!isVoiceOutputEnabled);
  }

  async function handleUpdateSummary() {
    if (!summaryDraft.trim() || phase !== "await_confirmation" || isBusy || isRecording || isTranscribing) {
      return;
    }
    if (isSummaryPreviewMode) {
      setSummarySource(summaryDraft);
      pushBotMessage("Preview summary updated locally.");
      return;
    }
    if (summaryDraft.trim() === summarySource.trim()) {
      return;
    }
    await submitMessage(`EDIT_SUMMARY::${summaryDraft.trim()}`);
  }

  async function handleSendToBianomics() {
    if (phase !== "await_confirmation" || isBusy || isRecording || isTranscribing) {
      return;
    }
    if (isSummaryPreviewMode) {
      pushBotMessage("Preview mode is active. Submission is disabled. Click Restart Intake to return to live flow.");
      return;
    }
    if (summaryDraft.trim() && summaryDraft.trim() !== summarySource.trim()) {
      const saved = await submitMessage(`EDIT_SUMMARY::${summaryDraft.trim()}`);
      if (!saved) {
        return;
      }
    }
    await submitMessage("Submit");
  }

  function loadSummaryPreview() {
    if (isBusy) {
      return;
    }
    stopRecording();
    stopSpeaking();
    clearVoiceError();
    setIsSummaryPreviewMode(true);
    setSummarySource(TEST_SUMMARY_TEMPLATE);
    setSummaryDraft(TEST_SUMMARY_TEMPLATE);
    setSuggestions([]);
    setPhase("await_confirmation");
    pushBotMessage("Loaded test summary preview. Keys are locked and values are editable.");
  }

  async function handleRestartIntake() {
    stopRecording();
    stopSpeaking();
    clearVoiceError();
    if (isSummaryPreviewMode) {
      setIsSummaryPreviewMode(false);
      await startNewChat();
      return;
    }
    await submitMessage("Restart");
  }

  function handleSummaryValueChange(segmentIndex, nextValue) {
    setSummaryDraft((previousDraft) => {
      const parsed = parseSummarySegments(previousDraft);
      const targetSegment = parsed.segments[segmentIndex];
      if (!targetSegment || targetSegment.type !== "pair") {
        return previousDraft;
      }
      const nextSegments = parsed.segments.map((segment, index) =>
        index === segmentIndex ? { ...segment, value: nextValue } : segment
      );
      return stringifySummarySegments(nextSegments);
    });
  }

  function handleThemeToggle() {
    const next = toggleTheme();
    setCurrentTheme(next);
  }

  function handleNotificationsToggle() {
    setNotificationsEnabled((prev) => !prev);
  }

  async function handleLogout() {
    if (!profile || isBusy) {
      return;
    }

    stopRecording();
    stopSpeaking();
    clearVoiceError();
    setIsProfilePanelOpen(false);
    setWelcomeNotice("");
    setIsBusy(true);
    try {
      const response = await sendChatMessage({
        session_id: sessionId || null,
        message: "",
        reset: true,
      });
      lastWelcomedClientCodeRef.current = "";
      hydrateFromResponse(response, { resetMessages: true });
    } catch {
      lastWelcomedClientCodeRef.current = "";
      setProfile(null);
      setPhase("await_client_code");
      setSuggestions([]);
      setMessages([
        makeMessage(
          "bot",
          "You have been logged out. Let’s get you into your workspace. Enter your client code below."
        ),
      ]);
    } finally {
      setIsBusy(false);
    }
  }

  useEffect(() => {
    initializeChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const currentClientCode = String(profile?.client_code ?? "").trim().toUpperCase();
    if (!currentClientCode || currentClientCode === lastWelcomedClientCodeRef.current) {
      return;
    }
    lastWelcomedClientCodeRef.current = currentClientCode;
    setWelcomeNotice(`Welcome, ${profile?.client_name ?? currentClientCode}. Your workspace is ready.`);
    if (welcomeTimeoutRef.current) {
      clearTimeout(welcomeTimeoutRef.current);
    }
    welcomeTimeoutRef.current = setTimeout(() => {
      setWelcomeNotice("");
      welcomeTimeoutRef.current = null;
    }, 3500);
    setIsSidebarOpen(true);
  }, [profile?.client_code, profile?.client_name]);

  useEffect(
    () => () => {
      if (welcomeTimeoutRef.current) {
        clearTimeout(welcomeTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (profile) {
      return;
    }
    setIsProfilePanelOpen(false);
  }, [profile]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const chatWindow = chatWindowRef.current;
      if (chatWindow) {
        chatWindow.scrollTo({
          top: chatWindow.scrollHeight,
          behavior: "smooth",
        });
        return;
      }
      tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, suggestions, isBusy]);

  const userInitials = getUserInitials(profile);
  const creditMenuEntries = Object.entries(profile?.credit_menu ?? {});

  return (
    <section className={`chatbot-page ${isSidebarOpen ? "sidebar-open" : ""}`}>
      <button
        type="button"
        className={`sidebar-backdrop ${isSidebarOpen ? "show" : ""}`}
        onClick={() => setIsSidebarOpen(false)}
        aria-label="Close sidebar"
      />

      <button
        type="button"
        className={`profile-panel-backdrop ${isProfilePanelOpen ? "show" : ""}`}
        onClick={() => setIsProfilePanelOpen(false)}
        aria-label="Close profile panel"
      />

      <aside className={`chat-sidebar ${isSidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head">
          <img src={BOT_AVATAR_URL} alt="biaBot avatar" />
          <div>
            <p>BiaBot</p>
            <small>AI Intake Assistant</small>
          </div>
        </div>

        <p className="sidebar-description">
          Conversational assistant that understands free-form replies and captures structured intake details.
        </p>

        <button type="button" className="primary-btn sidebar-action" onClick={startNewChat}>
          + New Chat
        </button>

        <div className="sidebar-section">
          <h3>Navigation</h3>
          <nav className="sidebar-icons">
            <NavLink
              to="/admin"
              className={({ isActive }) => (isActive ? "sidebar-link-btn active" : "sidebar-link-btn")}
            >
              Admin
            </NavLink>
          </nav>
        </div>

        <div className="sidebar-section">
          <h3>Profile</h3>
          <button
            type="button"
            className="sidebar-profile sidebar-profile-btn"
            onClick={() => setIsProfilePanelOpen(true)}
            disabled={!profile}
            title={profile ? "View current profile" : "Verify client code to view profile"}
          >
            <div className="sidebar-profile-avatar">
              {userInitials}
            </div>
            <div>
              <p>{profile?.client_name ?? "Guest User"}</p>
              <small>{profile?.client_code ?? "No client verified"}</small>
              <small className="sidebar-profile-hint">
                {profile ? "Tap to view profile" : "Enter client code to load profile"}
              </small>
            </div>
          </button>
        </div>

        <div className="sidebar-section">
          <h3>Utilities</h3>
          <div className="sidebar-icons">
            <button
              type="button"
              className="icon-toggle"
              onClick={handleNotificationsToggle}
            >
              <span className="icon-mark">{notificationsEnabled ? "ON" : "OFF"}</span>
              <span>Notifications</span>
            </button>
            <button
              type="button"
              className="icon-toggle"
              onClick={handleThemeToggle}
            >
              <span className="icon-mark">{currentTheme === "dark" ? "D" : "L"}</span>
              <span>{currentTheme === "dark" ? "Dark Mode" : "Light Mode"}</span>
            </button>
          </div>
          {profile && (
            <button
              type="button"
              className="danger-btn sidebar-logout-btn"
              onClick={handleLogout}
              disabled={isBusy}
            >
              Logout
            </button>
          )}
        </div>
      </aside>

      <aside className={`profile-panel ${isProfilePanelOpen ? "open" : ""}`} aria-hidden={!isProfilePanelOpen}>
        <div className="profile-panel-head">
          <div>
            <p className="chatbot-tag">Workspace Profile</p>
            <h3>{profile?.client_name ?? "Client Profile"}</h3>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setIsProfilePanelOpen(false)}
            aria-label="Close profile panel"
          >
            Close
          </button>
        </div>

        {!profile && (
          <p className="muted-text">Enter your client code in chat to load your profile details.</p>
        )}

        {profile && (
          <div className="profile-panel-body">
            <p className="profile-readonly-note">
              Profile updates are read-only here. Chat with BiaBot to request profile changes.
            </p>

            <div className="profile-meta-grid">
              <div className="profile-meta-item">
                <p className="profile-meta-label">Client Name</p>
                <p className="profile-meta-value">{displayText(profile.client_name)}</p>
              </div>
              <div className="profile-meta-item">
                <p className="profile-meta-label">Client Code</p>
                <p className="profile-meta-value">{displayText(profile.client_code)}</p>
              </div>
              <div className="profile-meta-item">
                <p className="profile-meta-label">Subscription Tier</p>
                <p className="profile-meta-value">{displayText(profile.subscription_tier)}</p>
              </div>
              <div className="profile-meta-item">
                <p className="profile-meta-label">Preferred Tone</p>
                <p className="profile-meta-value">{displayText(profile.preferred_tone)}</p>
              </div>
              <div className="profile-meta-item">
                <p className="profile-meta-label">Default Approver</p>
                <p className="profile-meta-value">{displayText(profile.default_approver)}</p>
              </div>
              <div className="profile-meta-item">
                <p className="profile-meta-label">Custom Service Options</p>
                <p className="profile-meta-value">
                  {profile.service_options?.length
                    ? `${profile.service_options.length} configured`
                    : "Using global service options"}
                </p>
              </div>
            </div>

            <div className="profile-block">
              <h4>Brand Voice Rules</h4>
              <p>{displayText(profile.brand_voice_rules)}</p>
            </div>

            <div className="profile-block">
              <h4>Required Disclaimers</h4>
              <p>{displayText(profile.required_disclaimers)}</p>
            </div>

            <div className="profile-block">
              <h4>Turnaround Rules (Optional)</h4>
              <p>{displayText(profile.turnaround_rules)}</p>
            </div>

            <div className="profile-block">
              <h4>Compliance Notes (Optional)</h4>
              <p>{displayText(profile.compliance_notes)}</p>
            </div>

            <div className="profile-block">
              <h4>Words To Avoid</h4>
              <div className="profile-tag-list">
                {(profile.words_to_avoid ?? []).map((item, index) => (
                  <span key={`avoid-${item}-${index}`} className="profile-tag">
                    {item}
                  </span>
                ))}
                {(profile.words_to_avoid ?? []).length === 0 && <span className="muted-text">None configured.</span>}
              </div>
            </div>

            <div className="profile-block">
              <h4>Common Audiences</h4>
              <div className="profile-tag-list">
                {(profile.common_audiences ?? []).map((item, index) => (
                  <span key={`audience-${item}-${index}`} className="profile-tag">
                    {item}
                  </span>
                ))}
                {(profile.common_audiences ?? []).length === 0 && (
                  <span className="muted-text">None configured.</span>
                )}
              </div>
            </div>

            <div className="profile-block">
              <h4>Credit Menu</h4>
              <div className="table-scroll">
                <table className="profile-credit-table">
                  <thead>
                    <tr>
                      <th>Service Key</th>
                      <th>Credits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditMenuEntries.length === 0 && (
                      <tr>
                        <td colSpan={2} className="empty-table-cell">No credit menu items found.</td>
                      </tr>
                    )}
                    {creditMenuEntries.map(([serviceKey, credits]) => (
                      <tr key={serviceKey}>
                        <td>{serviceKey}</td>
                        <td>{credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </aside>

      <div className={`chat-main ${phase === "await_confirmation" ? "review-mode" : ""}`}>
        <div className="chat-topbar">
          <div className="chat-topbar-left">
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
              title={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <span />
              <span />
              <span />
            </button>
            <div className="chat-top-titles">
              <div className="topbar-brand">
                <img src={BOT_AVATAR_URL} alt="biaBot" className="topbar-avatar" />
                <div>
                  <p className="chatbot-tag">BiaBot</p>
                  <h2>AI Conversational Intake</h2>
                </div>
              </div>
            </div>
          </div>
          <div className="chat-topbar-right">
            <button
              type="button"
              className={`voice-output-toggle topbar-voice-toggle ${isVoiceOutputEnabled ? "active" : ""}`}
              onClick={handleVoiceOutputToggle}
              aria-label={isVoiceOutputEnabled ? "Disable AI voice replies" : "Enable AI voice replies"}
              aria-pressed={isVoiceOutputEnabled}
              disabled={!canEnableVoiceOutput}
              title={
                canEnableVoiceOutput
                  ? isVoiceOutputEnabled
                    ? "AI voice replies are enabled"
                    : "Enable spoken AI replies"
                  : voiceToolbarNote
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.5 5.5a9 9 0 0 1 0 13" />
              </svg>
              <span>{isVoiceOutputEnabled ? "AI Voice On" : "AI Voice Off"}</span>
            </button>
            <button
              type="button"
              className={`topbar-icon-btn ${notificationsEnabled ? "active" : ""}`}
              onClick={handleNotificationsToggle}
              aria-label={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
              aria-pressed={notificationsEnabled}
              title={notificationsEnabled ? "Notifications on" : "Notifications off"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
                <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
                {!notificationsEnabled && <line x1="4" y1="4" x2="20" y2="20" />}
              </svg>
            </button>
            <button
              type="button"
              className="topbar-icon-btn"
              onClick={handleThemeToggle}
              aria-label={currentTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={currentTheme === "dark" ? "Light theme" : "Dark theme"}
            >
              {currentTheme === "dark" ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <line x1="12" y1="2" x2="12" y2="4" />
                  <line x1="12" y1="20" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
                  <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="4" y2="12" />
                  <line x1="20" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
                  <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="client-badge client-badge-btn"
              onClick={() => setIsProfilePanelOpen(true)}
              disabled={!profile}
              title={profile ? "View client profile" : "Verify client code first"}
            >
              <span>Client</span>
              <strong>{profile?.client_code ?? "Not verified"}</strong>
            </button>
          </div>
        </div>

        {welcomeNotice && <div className="status-banner welcome-popup">{welcomeNotice}</div>}
        {voiceStatusMessage && <div className={voiceStatusClassName}>{voiceStatusMessage}</div>}

        <div ref={chatWindowRef} className="chat-window">
          {messages.length === 0 && !isBusy && (
            <div className="chat-empty-state">
              <img src={BOT_AVATAR_URL} alt="biaBot" className="empty-state-avatar" />
              <h3>Welcome to BiaBot</h3>
              <p>Your AI-powered intake assistant. Start by sharing your client code.</p>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={`message-row ${message.role}`}>
              <div className={`avatar ${message.role}`}>
                {message.role === "bot" ? <img src={BOT_AVATAR_URL} alt="biaBot avatar" /> : userInitials}
              </div>
              <div className={`bubble ${message.role}`}>
                <div className="bubble-content">{message.text}</div>
              </div>
            </div>
          ))}

          {isBusy && (
            <div className="message-row bot">
              <div className="avatar bot">
                <img src={BOT_AVATAR_URL} alt="biaBot avatar" />
              </div>
              <div className="bubble bot typing-indicator">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          <div ref={tailRef} />
        </div>

        {suggestions.length > 0 && (
          <div className="chat-suggestions">
            {suggestions.map((option) => (
              <button
                key={option}
                type="button"
                className="chip-btn"
                onClick={() => onSuggestionClick(option)}
                disabled={isBusy}
              >
                {option}
              </button>
            ))}
          </div>
        )}
        {/* {import.meta.env.DEV && phase !== "await_confirmation" && (
          <div className="summary-test-shortcut">
            <button type="button" className="ghost-btn" onClick={loadSummaryPreview} disabled={isBusy}>
              Load Test Summary UI
            </button>
            <p className="muted-text">Dev shortcut: opens Final Review without completing every question.</p>
          </div>
        )} */}

        {phase === "await_confirmation" && (
          <section className="summary-editor-card">
            <div className="summary-editor-head">
              <p className="chatbot-tag">Final Review</p>
              <h3>Mission Summary</h3>
            </div>
            <p className="muted-text">
              Review your details before sending this request to Bianomics.
            </p>
            {isSummaryPreviewMode && (
              <p className="summary-preview-note">
                Test mode is active. Changes are local and will not be sent to Bianomics.
              </p>
            )}
            {hasStructuredSummary ? (
              <div className="summary-structured-editor">
                <p className="summary-editor-guide">Field names are locked. Edit only the values.</p>
                <div className="summary-structured-list">
                  {parsedSummary.segments.map((segment, index) => {
                    if (segment.type === "pair") {
                      const fieldId = `summary-field-${index}`;
                      return (
                        <div className="summary-field-row" key={fieldId}>
                          <label className="summary-field-key" htmlFor={fieldId}>
                            {segment.key}
                          </label>
                          <textarea
                            id={fieldId}
                            className="summary-field-value"
                            value={segment.value}
                            rows={1}
                            onChange={(event) => handleSummaryValueChange(index, event.target.value)}
                            disabled={isBusy}
                          />
                        </div>
                      );
                    }

                    const trimmedText = segment.text.trim();
                    if (!trimmedText) {
                      return <div className="summary-editor-gap" key={`summary-gap-${index}`} aria-hidden="true" />;
                    }
                    if (trimmedText === "---") {
                      return <hr className="summary-editor-rule" key={`summary-rule-${index}`} />;
                    }
                    return (
                      <p className="summary-editor-static-line" key={`summary-text-${index}`}>
                        {segment.text}
                      </p>
                    );
                  })}
                </div>
              </div>
            ) : (
              <textarea
                className="summary-editor-textarea"
                value={summaryDraft}
                onChange={(event) => setSummaryDraft(event.target.value)}
                placeholder="Your summary will appear here."
                disabled={isBusy}
              />
            )}
            <div className="summary-editor-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={handleUpdateSummary}
                disabled={
                  isBusy ||
                  isRecording ||
                  isTranscribing ||
                  !summaryDraft.trim() ||
                  summaryDraft.trim() === summarySource.trim()
                }
              >
                Update Summary
              </button>
              <button
                type="button"
                className="primary-btn"
                onClick={handleSendToBianomics}
                disabled={isBusy || isRecording || isTranscribing || !summaryDraft.trim()}
              >
                Send to Bianomics
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={handleRestartIntake}
                disabled={isBusy || isRecording || isTranscribing}
              >
                Restart Intake
              </button>
            </div>
          </section>
        )}

        <form className="chat-composer" onSubmit={onComposerSubmit}>
          <button
            type="button"
            className={`voice-input-btn ${isRecording ? "recording" : ""}`}
            onClick={handleVoiceInputToggle}
            disabled={isBusy || !isVoiceInputSupported}
            aria-label={isRecording ? "Stop voice input" : "Start voice input"}
            aria-pressed={isRecording}
            title={
              isVoiceInputSupported
                ? isRecording
                  ? "Stop voice input"
                  : "Start voice input"
                : "Voice input works in Chrome or Edge-based browsers"
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
              <path d="M19 10a7 7 0 0 1-14 0" />
              <line x1="12" y1="19" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          </button>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={handleComposerChange}
            placeholder={composerPlaceholder(phase)}
            disabled={isBusy}
            readOnly={isRecording}
            aria-readonly={isRecording}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={isBusy || isRecording || !inputValue.trim()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span>Send</span>
          </button>
        </form>
      </div>
    </section>
  );
}
