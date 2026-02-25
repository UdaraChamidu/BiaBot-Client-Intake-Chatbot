import { useMemo, useState } from "react";

import QuestionCard from "../components/QuestionCard";
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
]);

function formatAnswer(answer) {
  if (Array.isArray(answer)) {
    return answer.join(", ");
  }
  return String(answer ?? "");
}

function normalizeServiceKey(serviceType, branchQuestions) {
  if (branchQuestions[serviceType]) {
    return serviceType;
  }
  return "Other";
}

export default function IntakePage() {
  const [mode, setMode] = useState("auth");
  const [clientCode, setClientCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [token, setToken] = useState("");
  const [profile, setProfile] = useState(null);
  const [flowData, setFlowData] = useState(null);

  const [serviceType, setServiceType] = useState("");
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState("");
  const [submitResult, setSubmitResult] = useState(null);

  const currentQuestion = useMemo(
    () => questions[currentIndex] ?? null,
    [questions, currentIndex]
  );

  async function handleClientCodeAuth(event) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const auth = await authenticateClientCode(clientCode.trim());
      const intakeOptions = await fetchIntakeOptions(auth.access_token);
      setToken(auth.access_token);
      setProfile(auth.profile);
      setFlowData(intakeOptions);
      setAnswers({
        approver: auth.profile.default_approver ?? "",
      });
      setMode("service");
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Could not validate client code.");
    } finally {
      setLoading(false);
    }
  }

  function startQuestionFlow(selectedServiceType) {
    const branchKey = normalizeServiceKey(
      selectedServiceType,
      flowData.branch_questions
    );
    const branch = flowData.branch_questions[branchKey] ?? [];
    const uploadQuestion = {
      id: "uploaded_files",
      label: "Upload files (optional)",
      question_type: "file",
      required: false,
      options: [],
    };
    const orderedQuestions = [...flowData.core_questions, ...branch, uploadQuestion];

    setServiceType(selectedServiceType);
    setQuestions(orderedQuestions);
    setCurrentIndex(0);
    setHistory([]);
    setSummary("");
    setSubmitResult(null);
    setMode("questions");
  }

  async function finishQuestions(nextAnswers) {
    setLoading(true);
    setError("");
    try {
      const payload = buildPayload(nextAnswers);
      const preview = await previewIntake(token, payload);
      setSummary(preview.summary);
      setMode("review");
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Could not generate summary preview.");
    } finally {
      setLoading(false);
    }
  }

  function buildPayload(sourceAnswers) {
    const referencesRaw = sourceAnswers.references ?? "";
    const references = String(referencesRaw)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const branchAnswers = Object.fromEntries(
      Object.entries(sourceAnswers).filter(([key]) => !CORE_FIELDS.has(key))
    );

    return {
      service_type: serviceType,
      project_title: sourceAnswers.project_title ?? "",
      goal: sourceAnswers.goal ?? "",
      target_audience: sourceAnswers.target_audience ?? "",
      primary_cta: sourceAnswers.primary_cta ?? "",
      time_sensitivity: sourceAnswers.time_sensitivity ?? "Standard",
      due_date: sourceAnswers.due_date ?? "",
      approver: sourceAnswers.approver ?? null,
      required_elements: sourceAnswers.required_elements ?? null,
      references,
      uploaded_files: Array.isArray(sourceAnswers.uploaded_files)
        ? sourceAnswers.uploaded_files
        : [],
      branch_answers: branchAnswers,
      notes: sourceAnswers.notes ?? null,
    };
  }

  function handleQuestionAnswer(value) {
    if (!currentQuestion) {
      return;
    }
    const nextAnswers = { ...answers, [currentQuestion.id]: value };
    setAnswers(nextAnswers);
    setHistory((prev) => [
      ...prev,
      { question: currentQuestion.label, answer: formatAnswer(value) },
    ]);

    if (currentIndex >= questions.length - 1) {
      finishQuestions(nextAnswers);
      return;
    }
    setCurrentIndex((prev) => prev + 1);
  }

  function handleSkip() {
    handleQuestionAnswer("");
  }

  async function handleFinalSubmit() {
    setLoading(true);
    setError("");
    try {
      const payload = buildPayload(answers);
      const result = await submitIntake(token, payload);
      setSubmitResult(result);
      setMode("submitted");
    } catch (requestError) {
      const detail = requestError?.response?.data?.detail;
      setError(detail ?? "Submission failed.");
    } finally {
      setLoading(false);
    }
  }

  function resetFlow() {
    setMode("auth");
    setClientCode("");
    setToken("");
    setProfile(null);
    setFlowData(null);
    setServiceType("");
    setQuestions([]);
    setCurrentIndex(0);
    setAnswers({});
    setHistory([]);
    setSummary("");
    setSubmitResult(null);
    setError("");
  }

  function editAnswers() {
    setCurrentIndex(0);
    setHistory([]);
    setMode("questions");
  }

  return (
    <section className="card intake-page">
      <div className="intro-row">
        <div>
          <h2>Client Intake Chatbot</h2>
          <p>
            Guided request intake with one-question-at-a-time flow, branching,
            and contractor-ready summary output.
          </p>
        </div>
        {profile && (
          <div className="profile-pill">
            <p>{profile.client_name}</p>
            <small>
              {profile.client_code} | {profile.subscription_tier ?? "Tier N/A"}
            </small>
          </div>
        )}
      </div>

      {error && <p className="error-banner">{error}</p>}

      {mode === "auth" && (
        <form onSubmit={handleClientCodeAuth} className="stacked-form">
          <label htmlFor="client-code">Please enter your client code.</label>
          <input
            id="client-code"
            value={clientCode}
            onChange={(event) => setClientCode(event.target.value)}
            required
            placeholder="e.g. READYONE01"
          />
          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? "Validating..." : "Continue"}
          </button>
          <p className="muted">
            Invalid code? Contact Support: <strong>support@bianomics.com</strong>
          </p>
        </form>
      )}

      {mode === "service" && flowData && (
        <section className="question-card">
          <h3>What kind of support do you need?</h3>
          <div className="quick-reply-grid">
            {flowData.service_options.map((option) => (
              <button
                key={option}
                type="button"
                className="choice-btn"
                onClick={() => startQuestionFlow(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </section>
      )}

      {mode === "questions" && currentQuestion && (
        <div className="chat-flow">
          <div className="history-log">
            {history.map((entry) => (
              <div key={`${entry.question}-${entry.answer}`} className="history-item">
                <p className="history-question">{entry.question}</p>
                <p className="history-answer">{entry.answer || "(skipped)"}</p>
              </div>
            ))}
          </div>
          <QuestionCard
            key={currentQuestion.id}
            question={currentQuestion}
            defaultValue={answers[currentQuestion.id] ?? ""}
            onSubmit={handleQuestionAnswer}
            onSkip={handleSkip}
          />
          <p className="muted">
            Question {currentIndex + 1} of {questions.length}
          </p>
        </div>
      )}

      {mode === "review" && (
        <section className="review-block">
          <h3>Review before submission</h3>
          <pre>{summary}</pre>
          <div className="review-actions">
            <button type="button" className="ghost-btn" onClick={editAnswers}>
              Edit Answers
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={handleFinalSubmit}
              disabled={loading}
            >
              {loading ? "Submitting..." : "Submit to Bianomics"}
            </button>
          </div>
        </section>
      )}

      {mode === "submitted" && submitResult && (
        <section className="review-block success-block">
          <h3>Request submitted</h3>
          <p>
            Request ID: <strong>{submitResult.request_id}</strong>
          </p>
          <p>
            Monday Item: <strong>{submitResult.monday.item_id}</strong>
          </p>
          <p>Mock mode: {submitResult.monday.mock_mode ? "Yes" : "No"}</p>
          <button type="button" className="primary-btn" onClick={resetFlow}>
            Start Another Request
          </button>
        </section>
      )}
    </section>
  );
}
