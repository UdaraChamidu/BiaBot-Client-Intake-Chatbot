import { useMemo, useState } from "react";

export default function QuestionCard({
  question,
  onSubmit,
  defaultValue = "",
  onSkip,
}) {
  const [value, setValue] = useState(defaultValue);
  const [selectedFiles, setSelectedFiles] = useState([]);

  const inputValue = useMemo(() => {
    if (question.question_type === "file") {
      return selectedFiles;
    }
    return value;
  }, [question.question_type, selectedFiles, value]);

  function handleChoice(option) {
    onSubmit(option);
  }

  function handleFileSelect(event) {
    const files = Array.from(event.target.files ?? []);
    const names = files.map((file) => file.name);
    setSelectedFiles(names);
  }

  function handleNext(event) {
    event.preventDefault();
    if (question.question_type === "file") {
      onSubmit(selectedFiles);
      return;
    }
    if (!question.required && !value) {
      onSkip?.();
      return;
    }
    onSubmit(value);
  }

  if (question.question_type === "choice") {
    return (
      <section className="question-card">
        <h3>{question.label}</h3>
        <div className="quick-reply-grid">
          {question.options.map((option) => (
            <button
              key={option}
              className="choice-btn"
              type="button"
              onClick={() => handleChoice(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="question-card">
      <h3>{question.label}</h3>
      <form onSubmit={handleNext} className="question-form">
        {question.question_type === "date" && (
          <input
            type="date"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required={question.required}
          />
        )}

        {question.question_type === "file" && (
          <div className="file-upload-box">
            <input type="file" multiple onChange={handleFileSelect} />
            <p className="muted">
              MVP local mode stores file names only. Full storage can be added in
              production.
            </p>
            {inputValue.length > 0 && (
              <p className="muted">Selected: {inputValue.join(", ")}</p>
            )}
          </div>
        )}

        {question.question_type === "text" && (
          <textarea
            rows="4"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required={question.required}
            placeholder="Type your answer"
          />
        )}

        <div className="question-actions">
          {!question.required && question.question_type !== "choice" && (
            <button type="button" className="ghost-btn" onClick={onSkip}>
              Skip
            </button>
          )}
          <button type="submit" className="primary-btn">
            Next
          </button>
        </div>
      </form>
    </section>
  );
}
