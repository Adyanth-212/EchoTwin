import { useEffect, useRef, useState } from "react";

const SOURCE_BADGE = {
  ollama: "LLM",
  rules: "Rules",
  error: "Offline",
};

// Ask-the-twin. The endpoint is a plain GET with no body and no streaming;
// the backend assembles the room's live sensor context itself and either gets
// an LLM answer back or falls through to the rule-based text. Which one
// happened is shown on every answer, because during a demo it matters whether
// the model answered or the fallback did.
export default function AskTwin(props) {
  const [draft, setDraft] = useState("");
  const logRef = useRef(null);

  const messages = props.messages || [];
  const isPending = props.isPending;

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages.length, isPending]);

  function handleSubmit(event) {
    event.preventDefault();
    if (isPending) {
      return;
    }
    const question = draft;
    setDraft("");
    props.onAsk(question);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">Ask the twin</span>
        <span className="microlabel">Grounded in live readings</span>
      </div>

      <div className="ask-log" ref={logRef}>
        {messages.length === 0 && !isPending ? (
          <p className="panel-empty">
            Ask about this room's current state — the answer is built from the
            readings above.
          </p>
        ) : null}

        {messages.map((message) =>
          message.role === "user" ? (
            <div className="ask-msg" data-role="user" key={message.id}>
              {message.text}
            </div>
          ) : (
            <div className="ask-msg" data-role="twin" key={message.id}>
              <div className="ask-msg-head">
                <span className="microlabel">Twin</span>
                <span className="source-badge" data-source={message.source}>
                  {SOURCE_BADGE[message.source] || "Rules"}
                </span>
              </div>
              <ul className="ask-answer-list">
                {message.lines.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          )
        )}

        {isPending ? (
          <div className="ask-msg" data-role="twin">
            <div className="ask-msg-head">
              <span className="microlabel">Twin</span>
            </div>
            {/* The LLM hop can take 15s or more. Saying so beats a spinner
                that looks indistinguishable from a hang. */}
            <span style={{ color: "var(--dim)" }}>
              Thinking — the model can take up to 30s
              <span className="thinking-dots" />
            </span>
          </div>
        ) : null}
      </div>

      <form className="ask-form" onSubmit={handleSubmit}>
        <input
          className="ask-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Is this room safe to work in?"
          aria-label="Ask the twin about this room"
        />
        <button
          type="submit"
          className="btn"
          disabled={isPending || draft.trim().length === 0}
        >
          Ask
        </button>
      </form>
    </section>
  );
}
