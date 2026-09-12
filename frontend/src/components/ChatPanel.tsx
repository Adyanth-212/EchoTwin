"use client";

import { useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  function appendToLastMessage(token: string) {
    setMessages((prev) => {
      const updated = [...prev];
      const lastIndex = updated.length - 1;
      updated[lastIndex] = { ...updated[lastIndex], content: updated[lastIndex].content + token };
      return updated;
    });
  }

  async function handleSend() {
    const question = input.trim();
    if (!question || isStreaming) return;

    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setInput("");
    setIsStreaming(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      if (!res.ok || !res.body) {
        throw new Error("The twin is unreachable right now.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as { response?: string; done?: boolean };
            if (chunk.response) appendToLastMessage(chunk.response);
          } catch {
            // skip malformed line
          }
        }
      }
    } catch (err) {
      appendToLastMessage(
        `\n[Error: ${err instanceof Error ? err.message : "something went wrong"}]`,
      );
    } finally {
      setIsStreaming(false);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-slate-900/60">
      <div ref={scrollRef} className="flex max-h-72 min-h-40 flex-col gap-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">Ask something about this room&apos;s current state.</p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              message.role === "user"
                ? "self-end bg-cyan-600/20 text-cyan-100"
                : "self-start bg-slate-800 text-slate-200"
            }`}
          >
            {message.content || (message.role === "assistant" && isStreaming ? "…" : "")}
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
        className="flex gap-2 border-t border-white/10 p-3"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="e.g. Is it safe to enter right now?"
          disabled={isStreaming}
          className="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-40"
        >
          {isStreaming ? "Asking…" : "Ask"}
        </button>
      </form>
    </div>
  );
}
