import { useCallback, useRef, useState } from "react";
import { fetchJson } from "../config.js";

// Ask-the-twin. /room-status/{room_id}/ai-advice is a plain non-streaming GET
// with no request body, so there is nothing to stream and nothing to post.
//
// The endpoint returns two different types in the same field:
//   { source: "ollama", advice: "a string" }
//   { source: "rules",  advice: ["an", "array"] }
// Both are normalised to an array here, once, so no component downstream has
// to type-check the payload. The source is carried through untouched because
// seeing whether the LLM or the rule fallback answered matters during a demo.

const REQUEST_TIMEOUT_MS = 30000;

function normaliseAdvice(advice) {
  if (Array.isArray(advice)) {
    return advice.filter((entry) => typeof entry === "string" && entry.length > 0);
  }
  if (typeof advice === "string" && advice.trim().length > 0) {
    return [advice.trim()];
  }
  return [];
}

export default function useAiAdvice(roomId) {
  const [messages, setMessages] = useState([]);
  const [isPending, setIsPending] = useState(false);
  const nextIdRef = useRef(1);

  const takeId = useCallback(() => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    return id;
  }, []);

  const ask = useCallback(
    async (question) => {
      const trimmed = (question || "").trim();
      if (trimmed.length === 0 || isPending || !roomId) {
        return;
      }

      setMessages((previous) =>
        previous.concat([{ id: takeId(), role: "user", text: trimmed }])
      );
      setIsPending(true);

      try {
        // The backend assembles the room's live context itself; the question
        // is not sent upstream, so the answer is grounded in current readings
        // rather than in the phrasing of the question.
        const payload = await fetchJson(
          "/room-status/" + roomId + "/ai-advice",
          { timeoutMs: REQUEST_TIMEOUT_MS }
        );

        const lines = normaliseAdvice(payload.advice);
        setMessages((previous) =>
          previous.concat([
            {
              id: takeId(),
              role: "twin",
              source: payload.source === "ollama" ? "ollama" : "rules",
              lines:
                lines.length > 0
                  ? lines
                  : ["No advice available for this room right now."],
            },
          ])
        );
      } catch (caught) {
        const reason =
          caught.name === "AbortError"
            ? "The twin did not answer in time. The rule-based suggestions on the left are still current."
            : "Could not reach the twin. The rule-based suggestions on the left are still current.";

        setMessages((previous) =>
          previous.concat([
            {
              id: takeId(),
              role: "twin",
              source: "error",
              lines: [reason],
            },
          ])
        );
      } finally {
        setIsPending(false);
      }
    },
    [roomId, isPending, takeId]
  );

  return { messages: messages, isPending: isPending, ask: ask };
}
