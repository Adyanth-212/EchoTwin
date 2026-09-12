import { useEffect, useState } from "react";
import { ROOM_ID, SENSOR_KEYS, SENSOR_META } from "../config.js";
import useHistory from "../hooks/useHistory.js";
import Sparkline from "./Sparkline.jsx";

const BUCKETS = ["raw", "1m", "5m", "15m", "1h", "6h", "1d"];
const SELECTION_KEY = "echotwin.history.sensor";

// Boolean channels have nothing meaningful to plot as a line.
const PLOTTABLE = SENSOR_KEYS.filter((key) => !SENSOR_META[key].boolean);

function readStoredSensor() {
  try {
    const stored = window.localStorage.getItem(SELECTION_KEY);
    if (stored && PLOTTABLE.indexOf(stored) !== -1) {
      return stored;
    }
  } catch (error) {
    // Storage unavailable; the default selection is fine.
  }
  return "eco2";
}

export default function HistoryPanel(props) {
  const [sensor, setSensor] = useState(readStoredSensor);
  const [bucket, setBucket] = useState("5m");

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTION_KEY, sensor);
    } catch (error) {
      // Remembering the last chart is a convenience, nothing depends on it.
    }
  }, [sensor]);

  // History comes from the backend, so in demo mode there is nothing to ask
  // for — fall back to the rolling series the WebSocket hook already keeps.
  const history = useHistory({
    roomId: ROOM_ID,
    sensor: sensor,
    bucket: bucket,
    enabled: !props.demoMode,
  });

  const livePoints = (props.liveHistory && props.liveHistory[sensor]) || [];

  const backendPoints = (history.series[sensor] || []).map((point) => ({
    t: new Date(point.timestamp).getTime(),
    v: Number(point.value),
  }));

  // Prefer the stored series; fall back to what this session has collected
  // when the backend has nothing yet, so the chart is never just empty.
  const usingLive =
    props.demoMode || (backendPoints.length < 2 && livePoints.length >= 2);
  const shownPoints = usingLive ? livePoints : backendPoints;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">History</span>
        <span className="microlabel">
          {usingLive ? "this session" : "stored series"}
        </span>
      </div>

      <div className="history-controls">
        <select
          className="select"
          value={sensor}
          onChange={(event) => setSensor(event.target.value)}
          aria-label="Sensor to chart"
        >
          {PLOTTABLE.map((key) => (
            <option value={key} key={key}>
              {SENSOR_META[key].label}
            </option>
          ))}
        </select>

        <select
          className="select"
          value={bucket}
          onChange={(event) => setBucket(event.target.value)}
          disabled={usingLive}
          aria-label="Time bucket"
        >
          {BUCKETS.map((option) => (
            <option value={option} key={option}>
              {option === "raw" ? "raw samples" : option + " buckets"}
            </option>
          ))}
        </select>

        {SENSOR_META[sensor].unit ? (
          <span className="microlabel">{SENSOR_META[sensor].unit}</span>
        ) : null}
      </div>

      {shownPoints.length < 2 && history.error ? (
        <p className="panel-empty">
          No history yet — the history service is unreachable.
        </p>
      ) : (
        <Sparkline points={shownPoints} sensorKey={sensor} />
      )}

      <div className="history-meta">
        {usingLive
          ? "Charting values collected since this page was opened."
          : history.meta
          ? history.meta.pointCount +
            " points · " +
            history.meta.bucket +
            " buckets · last 24h"
          : history.isLoading
          ? "Loading stored history…"
          : "No stored history for this sensor yet."}
      </div>
    </section>
  );
}
