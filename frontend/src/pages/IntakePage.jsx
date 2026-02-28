import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

import { sendChatMessage } from "../services/intakeService";
import { getStoredTheme, toggleTheme } from "../utils/theme";

const BOT_AVATAR_URL = "/avatar.png";

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

  const tailRef = useRef(null);
  const welcomeTimeoutRef = useRef(null);
  const lastWelcomedClientCodeRef = useRef("");

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
    setIsProfilePanelOpen(false);
    setInputValue("");
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
    if (!text || isBusy) {
      return;
    }

    pushUserMessage(text);
    setIsBusy(true);
    try {
      const response = await sendChatMessage({
        session_id: sessionId || null,
        message: text,
      });
      hydrateFromResponse(response);
    } catch {
      pushBotMessage("I could not process that message right now. Please try again.");
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
    await submitMessage(option);
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
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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
              to="/"
              className={({ isActive }) => (isActive ? "sidebar-link-btn active" : "sidebar-link-btn")}
              end
            >
              Client Intake
            </NavLink>
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

      <div className="chat-main">
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

        <div className="chat-window">
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

        <form className="chat-composer" onSubmit={onComposerSubmit}>
          <input
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder={composerPlaceholder(phase)}
            disabled={isBusy}
          />
          <button type="submit" className="send-btn" disabled={isBusy || !inputValue.trim()}>
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
