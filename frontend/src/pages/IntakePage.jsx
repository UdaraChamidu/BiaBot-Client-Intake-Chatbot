import { useEffect, useRef, useState } from "react";

import { sendChatMessage } from "../services/intakeService";

const BOT_AVATAR_URL = "/avatar.png";

function messageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function makeMessage(role, text) {
  return { id: messageId(), role, text };
}

function composerPlaceholder(phase) {
  if (phase === "await_client_code") {
    return "Tell me your client code. Example: READYONE01";
  }
  if (phase === "await_confirmation") {
    return "Type Submit or Restart";
  }
  return "Type your message";
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
  const [lightMode, setLightMode] = useState(false);

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

  useEffect(() => {
    initializeChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, suggestions, isBusy]);

  return (
    <section className={`chatbot-page ${lightMode ? "light-mode" : ""}`}>
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
            <p>biaBot</p>
            <small>AI Intake Assistant</small>
          </div>
        </div>

        <p className="sidebar-description">
          Conversational assistant that understands free-form replies and captures structured intake details.
        </p>

        <button type="button" className="primary-btn sidebar-action" onClick={startNewChat}>
          New Chat
        </button>

        <div className="sidebar-section">
          <h3>Profile</h3>
          <div className="sidebar-profile">
            <img src={BOT_AVATAR_URL} alt="profile" />
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
              <span className="icon-mark">N</span>
              <span>{notificationsEnabled ? "Notifications On" : "Notifications Off"}</span>
            </button>
            <button
              type="button"
              className="icon-toggle"
              onClick={() => setLightMode((prev) => !prev)}
            >
              <span className="icon-mark">T</span>
              <span>{lightMode ? "Dark Theme" : "Light Theme"}</span>
            </button>
          </div>
        </div>

        <div className="sidebar-section">
          <h3>Session</h3>
          <p className="sidebar-description">Current phase: {phase}</p>
          <p className="sidebar-description">Session ID: {sessionId || "Not initialized"}</p>
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
            <div>
              <p className="chatbot-tag">biaBot</p>
              <h2>AI Conversational Intake</h2>
            </div>
          </div>
          <div className="client-badge">
            <span>Client</span>
            <strong>{profile?.client_code ?? "Not verified"}</strong>
          </div>
        </div>

        <div className="chat-window">
          {messages.map((message) => (
            <div key={message.id} className={`message-row ${message.role}`}>
              <div className={`avatar ${message.role}`}>
                {message.role === "bot" ? <img src={BOT_AVATAR_URL} alt="biaBot avatar" /> : "u"}
              </div>
              <div className={`bubble ${message.role}`}>{message.text}</div>
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
          <button type="submit" className="primary-btn" disabled={isBusy || !inputValue.trim()}>
            Send
          </button>
        </form>
      </div>
    </section>
  );
}
