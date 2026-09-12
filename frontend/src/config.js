// Single source of truth for endpoints, room identity, sensor metadata and
// thresholds. Thresholds mirror backend/app/rules.py and backend/app/trend.py
// so the dashboard never disagrees with the fusion logic about what counts as
// a warning. If those change on the backend, change them here too.

const env = import.meta.env;

export const ROOM_ID = env.VITE_ROOM_ID || "corridor_a";

// Both of these are same-origin paths served by the Vite dev-server proxy
// (see vite.config.js), which is what keeps the backend's CORS allow-list
// out of the picture.
export const API_BASE = "/api";

// VITE_WS_URL bypasses the proxy entirely — only for pointing at the mock
// sender. Otherwise build a same-origin ws:// or wss:// URL.
export function resolveWsUrl() {
  if (env.VITE_WS_URL) {
    return env.VITE_WS_URL;
  }
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return scheme + "//" + window.location.host + "/ws/room-status";
}

export const DEMO_MODE = env.VITE_DEMO === "1";
export const AR_ENABLED = env.VITE_ENABLE_AR === "1";

// Only interrupt someone about a predicted threshold crossing if it is this
// close. A warning 6 hours out is not worth a notification.
export const TREND_ALERT_MINUTES = Number(env.VITE_TREND_ALERT_MINUTES) || 15;

// A reading older than this is shown dimmed — the value is still the last
// known truth, but it is no longer fresh.
export const STALE_AFTER_MS = 30000;

export const STATUS_ORDER = { green: 0, yellow: 1, red: 2 };

export const STATUS_LABEL = {
  green: "Normal",
  yellow: "Watch",
  red: "Critical",
};

// Order here is the order sensors are rendered in the grid.
export const SENSOR_KEYS = [
  "temperature",
  "humidity",
  "eco2",
  "tvoc",
  "aqi",
  "surface_temp",
  "vibration_magnitude",
  "vibration_trip",
  "occupancy_count",
];

// `warn` / `critical` are the upper bounds from rules.py. `warnLow` /
// `criticalLow` exist only for humidity, which is bad in both directions.
// `chartMax` bounds the sparkline when a series is flat, so a still line
// does not get magnified into noise.
export const SENSOR_META = {
  temperature: {
    label: "Air temperature",
    short: "Air temp",
    unit: "°C",
    decimals: 1,
    warn: 30,
    critical: 35,
    source: "ESP32",
  },
  humidity: {
    label: "Humidity",
    short: "Humidity",
    unit: "%",
    decimals: 0,
    warn: 70,
    critical: 80,
    warnLow: 30,
    criticalLow: 20,
    source: "ESP32",
  },
  eco2: {
    label: "eCO₂",
    short: "eCO₂",
    unit: "ppm",
    decimals: 0,
    warn: 1000,
    critical: 1500,
    source: "ESP32",
    // Estimated from a VOC sensor (ENS160), not a true NDIR CO2 reading.
    note: "Estimated from VOC, not NDIR",
  },
  tvoc: {
    label: "TVOC",
    short: "TVOC",
    unit: "ppb",
    decimals: 0,
    warn: 300,
    critical: 600,
    source: "ESP32",
  },
  aqi: {
    label: "Air quality index",
    short: "AQI",
    unit: "",
    decimals: 0,
    warn: 4,
    critical: 5,
    chartMax: 5,
    source: "ESP32",
    note: "Index 1–5, not a percentage",
  },
  surface_temp: {
    label: "Equipment surface temp",
    short: "Surface temp",
    unit: "°C",
    decimals: 1,
    warn: 40,
    critical: 45,
    source: "ESP32",
    note: "Infrared, aimed at one machine",
  },
  vibration_magnitude: {
    label: "Vibration",
    short: "Vibration",
    unit: "m/s²",
    decimals: 2,
    warn: 2.5,
    critical: 5,
    source: "ESP32",
  },
  vibration_trip: {
    label: "Vibration trip",
    short: "Trip sensor",
    unit: "",
    boolean: true,
    source: "ESP32",
  },
  occupancy_count: {
    label: "Occupancy",
    short: "Occupancy",
    unit: "people",
    decimals: 0,
    warn: 20,
    critical: 30,
    source: "Cameras",
  },
};

export function sensorLabel(key) {
  const meta = SENSOR_META[key];
  if (meta) {
    return meta.label;
  }
  return key;
}

// Renders a sensor value for display. A missing reading is an em dash — it
// must never be shown as 0, NaN or the word "null".
export function formatValue(key, value) {
  const meta = SENSOR_META[key] || {};

  if (meta.boolean) {
    if (value === null || value === undefined) {
      return "—";
    }
    return value ? "Tripped" : "Clear";
  }

  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  const decimals = meta.decimals === undefined ? 1 : meta.decimals;
  return Number(value).toFixed(decimals);
}

// Severity of a single reading against the rule thresholds, used for the
// equipment health dot and the sensor tiles. The room's own status always
// comes from the backend's fusion logic — this is per-sensor colour only.
export function severityFor(key, value) {
  const meta = SENSOR_META[key];
  if (!meta || value === null || value === undefined) {
    return "none";
  }

  if (meta.boolean) {
    return value ? "yellow" : "green";
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "none";
  }

  if (meta.criticalLow !== undefined && numeric <= meta.criticalLow) {
    return "red";
  }
  if (meta.critical !== undefined && numeric >= meta.critical) {
    return "red";
  }
  if (meta.warnLow !== undefined && numeric <= meta.warnLow) {
    return "yellow";
  }
  if (meta.warn !== undefined && numeric >= meta.warn) {
    return "yellow";
  }
  return "green";
}

// Every network call goes through this: same-origin, always time-limited,
// never allowed to reject into an unhandled promise at the call site.
export async function fetchJson(path, options) {
  const settings = options || {};
  const timeoutMs = settings.timeoutMs || 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(API_BASE + path, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Compact relative time for "last update" readouts. Returns a short string,
// never a date, because these are always recent by construction.
export function formatAgo(timestampMs, nowMs) {
  if (!timestampMs) {
    return "never";
  }
  const seconds = Math.max(0, Math.round(((nowMs || Date.now()) - timestampMs) / 1000));
  if (seconds < 2) {
    return "just now";
  }
  if (seconds < 60) {
    return seconds + "s ago";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes + "m ago";
  }
  const hours = Math.floor(minutes / 60);
  return hours + "h ago";
}

// The CV producers serve each person's floor position from the camera
// laptops themselves (cv/producer.py), proxied by Vite at these paths. A
// feed that is not running simply contributes nobody.
export const CAMERA_FEEDS = [
  { id: "cam1", path: "/cam1" },
  { id: "cam2", path: "/cam2" },
];

// Two cameras watching the same room see the same person twice. Detections
// this close together on the floor are treated as one person.
export const PERSON_MERGE_RADIUS_M = 0.7;

// Drop a person this long after the camera that saw them last reported, so a
// producer that dies does not leave figures standing in the room forever.
export const PERSON_TTL_MS = 6000;

// Same contract as fetchJson, but for the camera feeds, which live on a
// different origin and are expected to be absent most of the time.
export async function fetchCamera(path, options) {
  const settings = options || {};
  const timeoutMs = settings.timeoutMs || 3000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
