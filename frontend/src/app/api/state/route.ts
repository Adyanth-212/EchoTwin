import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Well under the 2.5s poll interval, so an unreachable backend falls back
// to demo data quickly instead of hanging on the OS-level TCP timeout.
const FETCH_TIMEOUT_MS = 2000;

// Proxies to Aditya's backend server-side so the browser never talks to a
// private/VPN-only address directly (avoids CORS entirely).
export async function GET() {
  const backendUrl = process.env.BACKEND_URL || "http://192.168.1.100:8000";

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl}/state`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reach backend" },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Backend responded ${upstream.status}` },
      { status: 502 },
    );
  }

  const data = await upstream.json();
  return NextResponse.json(data);
}
