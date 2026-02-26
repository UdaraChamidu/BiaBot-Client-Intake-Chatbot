import { useEffect, useMemo, useRef, useState } from "react";

import {
  authenticateClientCode,
  fetchIntakeOptions,
  previewIntake,
  submitIntake,
} from "../services/intakeService";

const CORE_FIELDS = new Set([
  "project_title",
  "goal",
  "target_audience",
  "primary_cta",
  "time_sensitivity",
  "due_date",
  "approver",
  "required_elements",
  "references",
  "uploaded_files",
  "notes",
]);

const SKIP_PATTERN = /^(skip|none|na|n\/a)$/i;
const SUBMIT_KEYWORDS = ["yes", "y", "submit", "confirm", "ok", "okay", "send"];
const RESTART_KEYWORDS = ["restart", "edit", "start over", "change"];
const BOT_AVATAR_URL = "/avatar.png";

function messageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function makeMessage(role, text) {
  return { id: messageId(), role, text };
}

function normalizeText(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueValues(values) {
  return Array.from(new Set(values));
}

function extractClientCodeCandidates(input) {
  const tokens = input.match(/[A-Za-z0-9_-]{4,}/g) ?? [];
  const blacklist = new Set([
    "my",
    "client",
    "code",
    "is",
    "name",
    "the",
    "for",
    "hello",
    "hi",
    "please",
    "thanks",
    "support",
  ]);

  const candidates = tokens
    .filter((token) => !blacklist.has(token.toLowerCase()))
    .filter((token) => /[a-z]/i.test(token) && /\d/.test(token))
    .map((token) => token.toUpperCase());

  return uniqueValues(candidates);
}

function matchOption(input, options) {
  if (!options?.length) {
    return null;
  }

  const normalizedInput = normalizeText(input);
  if (!normalizedInput) {
    return null;
  }

  const byExact = options.find((option) => normalizeText(option) === normalizedInput);
  if (byExact) {
    return byExact;
  }

  const byContains = options.find((option) => {
    const normalizedOption = normalizeText(option);
    return (
      normalizedInput.includes(normalizedOption) ||
      normalizedOption.includes(normalizedInput)
    );
  });
  if (byContains) {
    return byContains;
  }

  const aliasChecks = [
    { keyword: "campaign", includes: "campaign set" },
    { keyword: "graphic", includes: "graphic" },
    { keyword: "newsletter", includes: "newsletter" },
    { keyword: "press", includes: "press release" },
    { keyword: "other", includes: "other" },
    { keyword: "urgent", includes: "urgent" },
    { keyword: "soon", includes: "soon" },
    { keyword: "standard", includes: "standard" },
  ];

  for (const alias of aliasChecks) {
    if (normalizedInput.includes(alias.keyword)) {
      const match = options.find((option) =>
        normalizeText(option).includes(alias.includes)
      );
      if (match) {
        return match;
      }
    }
  }

  const yesNo = options.map((option) => normalizeText(option));
  if (yesNo.includes("yes") && yesNo.includes("no")) {
    if (/^(yes|y|yeah|yep)$/i.test(input)) {
      return options.find((option) => normalizeText(option) === "yes") ?? null;
    }
    if (/^(no|n|nope)$/i.test(input)) {
      return options.find((option) => normalizeText(option) === "no") ?? null;
    }
  }

  return null;
}

function parseDateInput(input) {
  const cleaned = input.replace(/\b(\d+)(st|nd|rd|th)\b/gi, "$1").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseListInput(input) {
  return input
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildQuestionQueue(serviceType, intakeOptions) {
  const branch =
    intakeOptions.branch_questions?.[serviceType] ??
    intakeOptions.branch_questions?.Other ??
    [];
  const uploadQuestion = {
    id: "uploaded_files",
    label: "Any files to attach? Type filenames or links. Type skip if none.",
    question_type: "text",
    required: false,
    options: [],
  };

  return [...(intakeOptions.core_questions ?? []), ...branch, uploadQuestion];
}

function buildSubmissionPayload(serviceType, answers) {
  const references = parseListInput(String(answers.references ?? ""));
  const uploadedFiles = parseListInput(String(answers.uploaded_files ?? ""));
  const branchAnswers = Object.fromEntries(
    Object.entries(answers).filter(([key]) => !CORE_FIELDS.has(key))
  );

  return {
    service_type: serviceType,
    project_title: answers.project_title ?? "",
    goal: answers.goal ?? "",
    target_audience: answers.target_audience ?? "",
    primary_cta: answers.primary_cta ?? "",
    time_sensitivity: answers.time_sensitivity ?? "Standard",
    due_date: answers.due_date ?? "",
    approver: answers.approver ?? null,
    required_elements: answers.required_elements ?? null,
    references,
    uploaded_files: uploadedFiles,
    branch_answers: branchAnswers,
    notes: answers.notes ?? null,
  };
}

function normalizeAnswerForQuestion(question, input) {
  const value = input.trim();
  const isSkipping = SKIP_PATTERN.test(value);

  if (!question.required && (value.length === 0 || isSkipping)) {
    return { ok: true, value: "" };
  }

  if (question.required && value.length === 0) {
    return {
      ok: false,
      message: "I need a response for this item before I can continue.",
    };
  }

  if (question.question_type === "choice") {
    const matched = matchOption(value, question.options ?? []);
    if (!matched) {
      return {
        ok: false,
        message: "Please choose one of the available options.",
        options: question.options ?? [],
      };
    }
    return { ok: true, value: matched };
  }

  if (question.question_type === "date") {
    const parsedDate = parseDateInput(value);
    if (!parsedDate) {
      return {
        ok: false,
        message:
          "Please provide a valid date. You can use YYYY-MM-DD or natural format like March 5, 2026.",
      };
    }
    return { ok: true, value: parsedDate };
  }

  return { ok: true, value };
}

function questionPrompt(question) {
  const optionalHint = question.required ? "" : " (type skip if not applicable)";
  return `${question.label}${optionalHint}`;
}

function composerPlaceholder(phase) {
  if (phase === "await_client_code") {
    return "Type your client code. Example: READYONE01";
  }
  if (phase === "await_confirmation") {
    return "Type submit or restart";
  }
  return "Type your message";
}

function wantsSubmit(input) {
  const normalized = normalizeText(input);
  return SUBMIT_KEYWORDS.some(
    (keyword) => normalized === keyword || normalized.includes(keyword)
  );
}

function wantsRestart(input) {
  const normalized = normalizeText(input);
  return RESTART_KEYWORDS.some(
    (keyword) => normalized === keyword || normalized.includes(keyword)
  );
}

export default function IntakePage() {
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [phase, setPhase] = useState("await_client_code");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [lightMode, setLightMode] = useState(false);

  const [token, setToken] = useState("");
  const [profile, setProfile] = useState(null);
  const [intakeOptions, setIntakeOptions] = useState(null);
  const [serviceType, setServiceType] = useState("");
  const [questions, setQuestions] = useState([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [summary, setSummary] = useState("");

  const tailRef = useRef(null);
  const currentQuestion = useMemo(
    () => questions[questionIndex] ?? null,
    [questions, questionIndex]
  );

  function pushBotMessage(text, nextSuggestions = []) {
    setMessages((prev) => [...prev, { id: messageId(), role: "bot", text }]);
    setSuggestions(nextSuggestions);
  }

  function pushUserMessage(text) {
    setMessages((prev) => [...prev, { id: messageId(), role: "user", text }]);
    setSuggestions([]);
  }

  function askCurrentQuestion(question) {
    const options = question.question_type === "choice" ? question.options ?? [] : [];
    const optionalChip = !question.required && question.question_type !== "choice" ? ["skip"] : [];
    pushBotMessage(questionPrompt(question), [...options, ...optionalChip]);
  }

  function resetForNewRequest() {
    setServiceType("");
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({
      approver: profile?.default_approver ?? "",
    });
    setSummary("");
    setPhase("await_service");
    pushBotMessage(
      "Ready for the next request. What kind of support do you need?",
      intakeOptions?.service_options ?? []
    );
  }

  function startNewChat() {
    setIsSidebarOpen(false);
    setInputValue("");
    setIsBusy(false);
    setServiceType("");
    setQuestions([]);
    setQuestionIndex(0);
    setAnswers({
      approver: profile?.default_approver ?? "",
    });
    setSummary("");

    if (profile && intakeOptions) {
      setPhase("await_service");
      setMessages([
        makeMessage("bot", "New chat started. What kind of support do you need?"),
      ]);
      setSuggestions(intakeOptions?.service_options ?? []);
      return;
    }

    setPhase("await_client_code");
    setMessages([
      makeMessage(
        "bot",
        "Hi, I am biaBot. Welcome back. Please share your client code to start your request."
      ),
    ]);
    setSuggestions([]);
  }

  async function handleClientCodeStep(text) {
    const candidates = extractClientCodeCandidates(text);
    if (!candidates.length) {
      pushBotMessage(
        "I could not detect a client code in that message. Please send it like READYONE01.",
        []
      );
      return;
    }

    setIsBusy(true);
    let lastError = "Invalid client code.";
    try {
      for (const candidate of candidates) {
        try {
          const auth = await authenticateClientCode(candidate);
          const options = await fetchIntakeOptions(auth.access_token);

          setToken(auth.access_token);
          setProfile(auth.profile);
          setIntakeOptions(options);
          setAnswers({
            approver: auth.profile.default_approver ?? "",
          });
          setPhase("await_service");
          setIsSidebarOpen(false);

          pushBotMessage(
            `Welcome back, ${auth.profile.client_name}. I verified client code ${auth.profile.client_code}. What kind of support do you need?`,
            options.service_options
          );
          return;
        } catch (error) {
          lastError = error?.response?.data?.detail ?? "Invalid client code.";
        }
      }

      pushBotMessage(
        `${lastError} Please try again or contact support@bianomics.com.`,
        []
      );
    } finally {
      setIsBusy(false);
    }
  }

  function handleServiceStep(text) {
    const available = intakeOptions?.service_options ?? [];
    const selected = matchOption(text, available);

    if (!selected) {
      pushBotMessage(
        "I could not match that service. Please choose one from the options below.",
        available
      );
      return;
    }

    const queue = buildQuestionQueue(selected, intakeOptions);
    setServiceType(selected);
    setQuestions(queue);
    setQuestionIndex(0);
    setPhase("await_question");
    setIsSidebarOpen(false);
    setSummary("");
    setAnswers((prev) => ({
      approver: prev.approver ?? profile?.default_approver ?? "",
    }));

    pushBotMessage(`Great. I selected "${selected}".`);
    if (queue.length > 0) {
      askCurrentQuestion(queue[0]);
    } else {
      pushBotMessage("I do not have questions configured for this service yet.");
      setPhase("await_service");
    }
  }

  async function handleQuestionStep(text) {
    if (!currentQuestion) {
      pushBotMessage("I lost the question flow state. Starting from service selection.");
      setPhase("await_service");
      setSuggestions(intakeOptions?.service_options ?? []);
      return;
    }

    const normalized = normalizeAnswerForQuestion(currentQuestion, text);
    if (!normalized.ok) {
      pushBotMessage(normalized.message, normalized.options ?? []);
      return;
    }

    const nextAnswers = {
      ...answers,
      [currentQuestion.id]: normalized.value,
    };
    setAnswers(nextAnswers);

    const isLastQuestion = questionIndex >= questions.length - 1;
    if (!isLastQuestion) {
      const nextIndex = questionIndex + 1;
      setQuestionIndex(nextIndex);
      askCurrentQuestion(questions[nextIndex]);
      return;
    }

    setIsBusy(true);
    setPhase("building_summary");
    pushBotMessage("Thanks. I am preparing your mission summary.");
    try {
      const payload = buildSubmissionPayload(serviceType, nextAnswers);
      const preview = await previewIntake(token, payload);
      setSummary(preview.summary);
      setPhase("await_confirmation");
      pushBotMessage(`Mission Summary\n\n${preview.summary}`);
      pushBotMessage("Submit this request to Bianomics now?", ["Submit", "Restart"]);
    } catch (error) {
      const detail =
        error?.response?.data?.detail ??
        "I could not generate the summary right now. Please try again.";
      setPhase("await_question");
      pushBotMessage(detail);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmationStep(text) {
    if (wantsRestart(text)) {
      setPhase("await_service");
      setServiceType("");
      setQuestions([]);
      setQuestionIndex(0);
      setAnswers({
        approver: profile?.default_approver ?? "",
      });
      setSummary("");
      pushBotMessage("No problem. Let's restart. What kind of support do you need?", intakeOptions?.service_options ?? []);
      return;
    }

    if (!wantsSubmit(text)) {
      pushBotMessage("Please type submit to send, or restart to redo the intake.", [
        "Submit",
        "Restart",
      ]);
      return;
    }

    setIsBusy(true);
    pushBotMessage("Submitting your request.");
    try {
      const payload = buildSubmissionPayload(serviceType, answers);
      const result = await submitIntake(token, payload);
      setPhase("done");
      pushBotMessage(
        `Request submitted successfully.\nRequest ID: ${result.request_id}\nMonday Item: ${result.monday.item_id}\nMock Mode: ${result.monday.mock_mode ? "Yes" : "No"}`,
        ["Start New Request"]
      );
    } catch (error) {
      const detail =
        error?.response?.data?.detail ?? "Submission failed. You can retry now.";
      setPhase("await_confirmation");
      pushBotMessage(detail, ["Submit", "Restart"]);
    } finally {
      setIsBusy(false);
    }
  }

  async function processIncomingMessage(text) {
    if (phase === "await_client_code") {
      await handleClientCodeStep(text);
      return;
    }
    if (phase === "await_service") {
      handleServiceStep(text);
      return;
    }
    if (phase === "await_question") {
      await handleQuestionStep(text);
      return;
    }
    if (phase === "await_confirmation") {
      await handleConfirmationStep(text);
      return;
    }
    if (phase === "done") {
      if (normalizeText(text).includes("start new request") || wantsRestart(text)) {
        resetForNewRequest();
      } else {
        pushBotMessage("Type Start New Request when you want to create another intake.", [
          "Start New Request",
        ]);
      }
    }
  }

  async function submitMessage(rawText) {
    const text = rawText.trim();
    if (!text || isBusy) {
      return;
    }
    pushUserMessage(text);
    await processIncomingMessage(text);
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
    if (messages.length === 0) {
      pushBotMessage(
        "Hi, I am biaBot. Welcome back. Please share your client code to start your request."
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, suggestions, isBusy]);

  return (
    <section className={`card chatbot-page ${lightMode ? "light-mode" : ""}`}>
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
            <small>Intelligent Intake System</small>
          </div>
        </div>

        <p className="sidebar-description">
          Conversational intake assistant for structured, contractor-ready request capture.
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
          <h3>Settings</h3>
          <button type="button" className="sidebar-link-btn">
            Intake Preferences
          </button>
          <button type="button" className="sidebar-link-btn">
            Saved Summaries
          </button>
          <button type="button" className="sidebar-link-btn">
            Help and Support
          </button>
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
              <h2>Conversational Intake</h2>
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
                {message.role === "bot" ? (
                  <img src={BOT_AVATAR_URL} alt="biaBot avatar" />
                ) : (
                  "u"
                )}
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
