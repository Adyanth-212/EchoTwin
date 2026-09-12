import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const SYSTEM_PREFIX =
  "You are the assistant embedded in EchoTwin, a live digital twin dashboard for a single " +
  "room. You have access to real-time sensor and camera data covering temperature, humidity, " +
  "air quality (eCO2/TVOC), non-contact surface temperature, vibration, and occupancy. Answer " +
  "questions about the room's current state concisely and helpfully.";

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Proxies to the local Ollama instance over Tailscale server-side, and pipes
// its newline-delimited streaming response straight back to the client.
export async function POST(request: NextRequest) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://100.69.187.59:11434";
  const model = process.env.OLLAMA_MODEL || "qwen3:8b";

  let question = "";
  try {
    const body = await request.json();
    question = typeof body?.question === "string" ? body.question : "";
  } catch {
    return jsonError("Invalid request body", 400);
  }

  if (!question.trim()) {
    return jsonError("question is required", 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: `${SYSTEM_PREFIX}\n\nQuestion: ${question}`,
        stream: true,
        keep_alive: -1,
      }),
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to reach Ollama", 502);
  }

  if (!upstream.ok || !upstream.body) {
    return jsonError(`Ollama responded ${upstream.status}`, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
