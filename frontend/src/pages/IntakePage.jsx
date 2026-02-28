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
    return "Share your client code to continue";
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

export default function IntakePage() {
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [phase, setPhase] = useState("await_client_code");
  const [sessionId, setSessionId] = useState("");
  const [profile, setProfile] = useState(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [currentTheme, setCurrentTheme] = useState(getStoredTheme());

  const tailRef = useRef(null);

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
    setIsSidebarOpen(false);
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

  useEffect(() => {
    initializeChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, suggestions, isBusy]);

  const userInitials = getUserInitials(profile);

  return (
    <section className="chatbot-page">
      <button
        type="button"
        className={`sidebar-backdrop ${isSidebarOpen ? "show" : ""}`}
        onClick={() => setIsSidebarOpen(false)}
        aria-label="Close sidebar"
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
          <div className="sidebar-profile">
            <div className="sidebar-profile-avatar">
              {userInitials}
            </div>
            <div>
              <p>{profile?.client_name ?? "Guest User"}</p>
              <small>{profile?.client_code ?? "No client verified"}</small>
            </div>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>Utilities</h3>
          <div className="sidebar-icons">
            <button
              type="button"
              className="icon-toggle"
              onClick={() => setNotificationsEnabled((prev) => !prev)}
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
        </div>
      </aside>

      <div className="chat-main">
        <div className="chat-topbar">
          <div className="chat-topbar-left">
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              aria-label="Open sidebar"
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
              className="theme-toggle-btn"
              onClick={handleThemeToggle}
              aria-label="Toggle theme"
              title={currentTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {currentTheme === "dark" ? "Light" : "Dark"}
            </button>
            <div className="client-badge">
              <span>Client</span>
              <strong>{profile?.client_code ?? "Not verified"}</strong>
            </div>
          </div>
        </div>

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
