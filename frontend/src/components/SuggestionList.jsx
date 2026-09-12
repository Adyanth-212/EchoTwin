const SOURCE_COPY = {
  socket: "live",
  rest: "from /room-status",
  none: "",
};

// Rule-based suggestions from the backend. These always exist regardless of
// whether the LLM is reachable, which is why they sit beside the chat panel
// rather than inside it.
export default function SuggestionList(props) {
  const suggestions = Array.isArray(props.suggestions) ? props.suggestions : [];

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">Suggested actions</span>
        <span className="microlabel">{SOURCE_COPY[props.source] || ""}</span>
      </div>

      {suggestions.length === 0 ? (
        <p className="panel-empty">
          Nothing to act on — no rule is currently triggered.
        </p>
      ) : (
        <ul className="suggestion-list">
          {suggestions.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
