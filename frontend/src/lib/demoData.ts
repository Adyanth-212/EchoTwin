import type { BackendState } from "./types";

function jitter(base: number, spread: number, decimals = 1): number {
  const value = base + (Math.random() - 0.5) * spread;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Small hardcoded dataset shown when /api/state can't be reached, so the
// dashboard demos cleanly even before every sensor is wired up. Timestamps
// and values refresh on every call so trend arrows and staleness still work.
export function getDemoState(): BackendState {
  const now = new Date().toISOString();

  return {
    readings: [
      { source: "sensor", source_id: "esp32-1", reading_type: "temperature", value: jitter(24.3, 0.6), timestamp: now },
      { source: "sensor", source_id: "esp32-1", reading_type: "humidity", value: jitter(41, 2), timestamp: now },
      { source: "sensor", source_id: "esp32-1", reading_type: "eco2", value: jitter(610, 30, 0), timestamp: now },
      { source: "sensor", source_id: "esp32-1", reading_type: "tvoc", value: jitter(88, 10, 0), timestamp: now },
      { source: "sensor", source_id: "esp32-1", reading_type: "ir_temperature", value: jitter(26.8, 0.8), timestamp: now },
      { source: "sensor", source_id: "esp32-1", reading_type: "vibration", value: jitter(0.02, 0.01, 3), timestamp: now },
      {
        source: "camera",
        source_id: "cam-1",
        reading_type: "occupancy",
        value: "occupied",
        confidence: 0.91,
        timestamp: now,
      },
    ],
    warnings: [],
    anomalies: [],
  };
}
