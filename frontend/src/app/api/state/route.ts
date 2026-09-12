import { NextResponse } from "next/server";
import type { BackendState, Reading } from "@/lib/types";

export const dynamic = "force-dynamic";

// Well under the 2.5s poll interval, so an unreachable backend falls back
// to demo data quickly instead of hanging on the OS-level TCP timeout.
const FETCH_TIMEOUT_MS = 2000;

// The backend has no single /state endpoint — this combines two of its
// real ones (confirmed by calling BACKEND_URL directly) into the
// {readings, warnings, anomalies} shape the dashboard is built around.
interface RoomStatus {
  room_id: string;
  timestamp: string;
  sensors: {
    temperature?: number;
    humidity?: number;
    eco2?: number;
    tvoc?: number;
    aqi?: number;
    surface_temp?: number;
    vibration_magnitude?: number;
  };
  anomaly?: { score: number; is_anomaly: boolean; top_features: string[] };
  suggestions?: string[];
}

interface CvEvent {
  camera_id: string;
  occupancy: number;
  confidence?: number | null;
  timestamp: string;
}

// Maps each room-status sensor field to the reading_type the UI's sensor
// metadata (icons/labels/units) already knows about.
const SENSOR_FIELD_TO_READING_TYPE: Record<string, string> = {
  temperature: "temperature",
  humidity: "humidity",
  eco2: "eco2",
  tvoc: "tvoc",
  aqi: "aqi",
  surface_temp: "ir_temperature",
  vibration_magnitude: "vibration",
};

function toBackendState(room: RoomStatus | undefined, cvEvent: CvEvent | undefined): BackendState {
  const readings: Reading[] = [];

  if (room) {
    for (const [field, readingType] of Object.entries(SENSOR_FIELD_TO_READING_TYPE)) {
      const value = room.sensors[field as keyof RoomStatus["sensors"]];
      if (typeof value === "number") {
        readings.push({
          source: "sensor",
          source_id: room.room_id,
          reading_type: readingType,
          value,
          timestamp: room.timestamp,
        });
      }
    }
  }

  if (cvEvent) {
    readings.push({
      source: "camera",
      source_id: cvEvent.camera_id,
      reading_type: "occupancy",
      value: cvEvent.occupancy,
      confidence: cvEvent.confidence ?? undefined,
      timestamp: cvEvent.timestamp,
    });
  }

  const warnings = room?.suggestions ?? [];
  const anomalies: string[] = [];
  if (room?.anomaly?.is_anomaly) {
    const features = room.anomaly.top_features.length
      ? `: ${room.anomaly.top_features.join(", ")}`
      : "";
    anomalies.push(`Anomaly detected in ${room.room_id} (score ${room.anomaly.score.toFixed(2)})${features}`);
  }

  return { readings, warnings, anomalies };
}

// Proxies to Aditya's backend server-side so the browser never talks to a
// private/VPN-only address directly (avoids CORS entirely).
export async function GET() {
  const backendUrl = process.env.BACKEND_URL || "http://192.168.1.100:8000";

  let roomStatuses: RoomStatus[];
  let cvEvents: CvEvent[] = [];

  try {
    const [roomRes, cvRes] = await Promise.all([
      fetch(`${backendUrl}/room-status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
      fetch(`${backendUrl}/cv-events?limit=1`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
    ]);

    if (!roomRes.ok) {
      return NextResponse.json({ error: `Backend responded ${roomRes.status}` }, { status: 502 });
    }

    roomStatuses = await roomRes.json();
    // Camera events are best-effort — occupancy isn't wired up on every rig yet.
    cvEvents = cvRes.ok ? await cvRes.json() : [];
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reach backend" },
      { status: 502 },
    );
  }

  return NextResponse.json(toBackendState(roomStatuses[0], cvEvents[0]));
}
