import { useEffect, useRef, useState } from "react";
import { DEMO_MODE, ROOM_ID, SENSOR_KEYS, resolveWsUrl } from "../config.js";

// Connects to the WS URL and keeps the latest message per room_id, using the
// shape fixed in schemas/mqtt_and_ws.md section 2. Reconnects on close so the
// dashboard survives the mock sender or backend restarting.
//
// Beyond the latest message it keeps two things the UI needs:
//   - a short rolling history per sensor, for trend arrows and the live
//     micro-charts, so we do not have to hit /history for a direction arrow
//   - the time each sensor's value last changed, which is the only freshness
//     signal available: the backend rebuilds `sensors` from the latest stored
//     value on every broadcast, so a dead sensor keeps re-reporting its last
//     reading rather than dropping to null

const HISTORY_LIMIT = 90;
const RECONNECT_DELAY_MS = 2000;

function appendHistory(previousSeries, value, at) {
  const series = previousSeries ? previousSeries.slice(-(HISTORY_LIMIT - 1)) : [];
  series.push({ t: at, v: value });
  return series;
}

// Folds one incoming message into the rolling history and change-time maps.
function foldMessage(state, message, receivedAt) {
  const roomId = message.room_id;
  const sensors = message.sensors || {};

  const rooms = Object.assign({}, state.rooms);
  rooms[roomId] = message;

  const roomHistory = Object.assign({}, state.historyByRoom[roomId] || {});
  const roomChanged = Object.assign({}, state.changedAtByRoom[roomId] || {});

  for (let index = 0; index < SENSOR_KEYS.length; index += 1) {
    const key = SENSOR_KEYS[index];
    const value = sensors[key];

    if (value === null || value === undefined) {
      continue;
    }

    const series = roomHistory[key] || [];
    const last = series.length > 0 ? series[series.length - 1] : null;

    if (last === null || last.v !== value) {
      roomChanged[key] = receivedAt;
    }

    roomHistory[key] = appendHistory(series, value, receivedAt);
  }

  const historyByRoom = Object.assign({}, state.historyByRoom);
  historyByRoom[roomId] = roomHistory;

  const changedAtByRoom = Object.assign({}, state.changedAtByRoom);
  changedAtByRoom[roomId] = roomChanged;

  const anomaly = message.anomaly || {};
  const previousStatus = state.statusByRoom[roomId] || [];
  const statusEntry = {
    t: receivedAt,
    status: message.status,
    isAnomaly: Boolean(anomaly.is_anomaly),
    score:
      anomaly.score === null || anomaly.score === undefined
        ? null
        : Number(anomaly.score),
  };

  const statusByRoom = Object.assign({}, state.statusByRoom);
  statusByRoom[roomId] = previousStatus
    .slice(-(STATUS_HISTORY_LIMIT - 1))
    .concat([statusEntry]);

  return {
    rooms: rooms,
    historyByRoom: historyByRoom,
    changedAtByRoom: changedAtByRoom,
    statusByRoom: statusByRoom,
    lastMessageAt: receivedAt,
  };
}

// Status and anomaly score are not available historically from any endpoint —
// the backend stores only the current room_status row. So the timeline is
// built from what this session has actually observed, and labelled as such.
const STATUS_HISTORY_LIMIT = 600;

const EMPTY_STATE = {
  rooms: {},
  historyByRoom: {},
  changedAtByRoom: {},
  statusByRoom: {},
  lastMessageAt: null,
};

export default function useRoomStatus() {
  const [state, setState] = useState(EMPTY_STATE);
  const [connectionState, setConnectionState] = useState(
    DEMO_MODE ? "demo" : "connecting"
  );

  // The newest message is also mirrored into a ref so consumers that react to
  // transitions (notifications) can read it without re-subscribing.
  const latestRef = useRef(null);

  useEffect(() => {
    function ingest(message) {
      if (!message || !message.room_id) {
        return;
      }
      latestRef.current = message;
      const receivedAt = Date.now();
      setState((previous) => foldMessage(previous, message, receivedAt));
    }

    if (DEMO_MODE) {
      const stopDemo = startDemoFeed(ingest);
      setConnectionState("demo");
      return stopDemo;
    }

    const wsUrl = resolveWsUrl();
    let socket = null;
    let reconnectTimer = null;
    let isUnmounted = false;

    function connect() {
      try {
        socket = new WebSocket(wsUrl);
      } catch (error) {
        // Constructing a WebSocket throws on a malformed URL — retry rather
        // than leaving the page with no data path at all.
        scheduleReconnect();
        return;
      }

      socket.onopen = () => {
        if (!isUnmounted) {
          setConnectionState("live");
        }
      };

      socket.onmessage = (event) => {
        let message = null;
        try {
          message = JSON.parse(event.data);
        } catch (error) {
          // A malformed frame is not worth tearing the connection down for.
          return;
        }
        ingest(message);
      };

      socket.onerror = () => {
        // onclose always follows, which is where the retry is scheduled.
      };

      socket.onclose = () => {
        if (!isUnmounted) {
          setConnectionState("reconnecting");
          scheduleReconnect();
        }
      };
    }

    function scheduleReconnect() {
      if (isUnmounted) {
        return;
      }
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    }

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket) {
        socket.close();
      }
    };
  }, []);

  return {
    rooms: state.rooms,
    historyByRoom: state.historyByRoom,
    changedAtByRoom: state.changedAtByRoom,
    statusByRoom: state.statusByRoom,
    lastMessageAt: state.lastMessageAt,
    connectionState: connectionState,
    isConnected: connectionState === "live" || connectionState === "demo",
    latestRef: latestRef,
  };
}

/* ------------------------------------------------------------------ */
/* Demo feed                                                           */
/* ------------------------------------------------------------------ */

// Synthetic WSMessage producer for VITE_DEMO=1. It runs a repeating scripted
// arc — calm, then air quality drifting up, then an equipment fault, then
// recovery — so the dashboard can be shown end to end with the backend
// unreachable, and so the notification path can be demonstrated on cue
// instead of waiting for a real fault to happen.

const DEMO_TICK_MS = 2000;
const DEMO_CYCLE_MS = 72000;

function jitter(base, spread) {
  return base + (Math.random() - 0.5) * spread;
}

function round(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function buildDemoMessage(elapsedMs) {
  const phasePosition = (elapsedMs % DEMO_CYCLE_MS) / DEMO_CYCLE_MS;

  let status = "green";
  let source = "sensor";
  let eco2 = jitter(620, 40);
  let tvoc = jitter(130, 30);
  let aqi = 2;
  let surfaceTemp = jitter(31, 0.8);
  let vibration = jitter(0.7, 0.3);
  let vibrationTrip = false;
  let anomaly = { is_anomaly: false, score: null, top_features: [] };
  let trend = { metric: null, time_to_threshold_minutes: null };

  if (phasePosition < 0.28) {
    // Calm baseline.
    status = "green";
  } else if (phasePosition < 0.5) {
    // Air quality climbing — this is the window where the trend banner and
    // its early-warning notification fire.
    const climb = (phasePosition - 0.28) / 0.22;
    eco2 = jitter(700 + climb * 340, 40);
    tvoc = jitter(180 + climb * 130, 30);
    aqi = climb > 0.6 ? 4 : 3;
    status = eco2 >= 1000 ? "red" : "yellow";
    source = "fusion";
    trend = {
      metric: "eco2",
      time_to_threshold_minutes: round(14 - climb * 9, 1),
    };
  } else if (phasePosition < 0.78) {
    // Equipment fault: surface temperature and vibration rising together,
    // which is the correlation the whole project is pitched on.
    const climb = (phasePosition - 0.5) / 0.28;
    surfaceTemp = jitter(38 + climb * 10, 0.7);
    vibration = jitter(2.2 + climb * 3.4, 0.4);
    vibrationTrip = climb > 0.35;
    eco2 = jitter(900, 50);
    tvoc = jitter(280, 30);
    aqi = 3;
    status = climb > 0.3 ? "red" : "yellow";
    source = "fusion";
    anomaly = {
      is_anomaly: climb > 0.2,
      // Positive and small, matching the real backend: it negates sklearn's
      // decision_function, so a higher score is more anomalous.
      score: climb > 0.2 ? round(0.02 + climb * 0.05, 4) : null,
      top_features:
        climb > 0.2 ? ["surface_temp", "vibration_magnitude"] : [],
    };
    trend = {
      metric: "surface_temp",
      time_to_threshold_minutes: round(Math.max(1, 11 - climb * 9), 1),
    };
  } else {
    // Recovery — deliberately quiet, to prove alerts do not fire on the way
    // back down.
    const cool = (phasePosition - 0.78) / 0.22;
    surfaceTemp = jitter(42 - cool * 11, 0.6);
    vibration = jitter(3.4 - cool * 2.8, 0.3);
    eco2 = jitter(820 - cool * 200, 40);
    status = cool > 0.55 ? "green" : "yellow";
    source = "fusion";
  }

  const occupancy = Math.max(
    0,
    Math.round(3 + Math.sin(elapsedMs / 21000) * 3 + (Math.random() - 0.5))
  );

  return {
    room_id: ROOM_ID,
    timestamp: new Date().toISOString(),
    status: status,
    source: source,
    sensors: {
      temperature: round(jitter(24.6, 0.7), 1),
      humidity: round(jitter(52, 3), 0),
      eco2: round(eco2, 0),
      tvoc: round(tvoc, 0),
      aqi: aqi,
      surface_temp: round(surfaceTemp, 1),
      vibration_magnitude: round(Math.max(0, vibration), 2),
      vibration_trip: vibrationTrip,
      occupancy_count: occupancy,
    },
    anomaly: anomaly,
    trend: trend,
    // The real socket does not carry suggestions (see README). The demo feed
    // includes them so the suggestion panel has something to show offline.
    suggestions: buildDemoSuggestions(status, anomaly, vibrationTrip),
  };
}

function buildDemoSuggestions(status, anomaly, vibrationTrip) {
  const suggestions = [];
  if (anomaly.is_anomaly) {
    suggestions.push(
      "Combined heat and vibration may indicate equipment stress or an emerging fault."
    );
  }
  if (vibrationTrip) {
    suggestions.push(
      "The vibration trip sensor was triggered — inspect nearby equipment."
    );
  }
  if (status !== "green" && suggestions.length === 0) {
    suggestions.push(
      "Estimated CO2 is rising — consider increasing ventilation."
    );
  }
  return suggestions;
}

function startDemoFeed(ingest) {
  const startedAt = Date.now();

  function tick() {
    ingest(buildDemoMessage(Date.now() - startedAt));
  }

  tick();
  const timer = setInterval(tick, DEMO_TICK_MS);

  return () => {
    clearInterval(timer);
  };
}
