import { useEffect, useRef, useState } from "react";
import { DEMO_MODE, fetchJson } from "../config.js";

// The rule-based suggestions are persisted and returned by REST but are not
// part of the WebSocket message model (see the note at the end of
// frontend/README.md). So: take them off the socket message when they are
// there — a backend change could add them at any time — and otherwise poll
// the REST endpoint that definitely has them.

const POLL_INTERVAL_MS = 15000;

export default function useRoomSuggestions(roomId, roomMessage) {
  const [restSuggestions, setRestSuggestions] = useState(null);
  const [source, setSource] = useState("none");
  const mountedRef = useRef(true);

  const fromSocket =
    roomMessage && Array.isArray(roomMessage.suggestions)
      ? roomMessage.suggestions
      : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Nothing to fetch when the socket already carries them, or when the
    // whole page is running off the demo generator.
    if (fromSocket !== null || DEMO_MODE || !roomId) {
      return undefined;
    }

    let cancelled = false;

    async function load() {
      try {
        const payload = await fetchJson("/room-status/" + roomId, {
          timeoutMs: 6000,
        });
        if (cancelled || !mountedRef.current) {
          return;
        }
        if (Array.isArray(payload.suggestions)) {
          setRestSuggestions(payload.suggestions);
          setSource("rest");
        }
      } catch (caught) {
        // Leave the last known suggestions on screen rather than blanking
        // the panel because one poll timed out.
      }
    }

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [roomId, fromSocket !== null]);

  if (fromSocket !== null) {
    return { suggestions: fromSocket, source: "socket" };
  }

  return { suggestions: restSuggestions || [], source: source };
}
