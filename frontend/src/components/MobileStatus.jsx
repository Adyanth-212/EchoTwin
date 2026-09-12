import { useEffect, useState } from "react";
import {
  AR_ENABLED,
  SENSOR_META,
  STATUS_LABEL,
  formatAgo,
  formatValue,
  sensorLabel,
} from "../config.js";
import { findMarker } from "../roomLayout.js";
import ArOverlay from "./ArOverlay.jsx";
import ToastStack from "./ToastStack.jsx";

// Phone-first view reached by scanning a QR code stuck on the equipment or
// at the room entrance:
//   /?view=mobile&room=corridor_a&target=equip_1
//
// Single column, large type, no 3D canvas — it has to be readable at arm's
// length in bad light on a phone that is also doing nothing else useful.

// Which readings matter depends on what you are standing in front of.
const READINGS_BY_KIND = {
  sensor: ["temperature", "humidity", "eco2", "tvoc", "aqi"],
  camera: ["occupancy_count"],
  equipment: ["surface_temp", "vibration_magnitude", "vibration_trip"],
};

const ROOM_READINGS = [
  "temperature",
  "eco2",
  "surface_temp",
  "occupancy_count",
];

const KIND_LABEL = {
  sensor: "Sensor node",
  camera: "Camera",
  equipment: "Equipment",
};

export default function MobileStatus(props) {
  const marker = props.targetId ? findMarker(props.targetId) : null;
  const room = props.room;
  const sensors = (room && room.sensors) || {};
  const status = room ? room.status : "unknown";

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const readingKeys = marker
    ? READINGS_BY_KIND[marker.kind] || ROOM_READINGS
    : ROOM_READINGS;

  const anomaly = (room && room.anomaly) || null;
  const isAnomaly = Boolean(anomaly && anomaly.is_anomaly);
  const features =
    isAnomaly && Array.isArray(anomaly.top_features)
      ? anomaly.top_features.map((key) => sensorLabel(key).toLowerCase())
      : [];

  const trend = (room && room.trend) || null;
  const trendMinutes =
    trend && trend.time_to_threshold_minutes !== undefined
      ? trend.time_to_threshold_minutes
      : null;

  const suggestions = Array.isArray(props.suggestions) ? props.suggestions : [];

  const isLive = props.connectionState === "live" || props.connectionState === "demo";

  const body = (
    <div className="mobile">
      <div className="mobile-target">
        <span className="mobile-target-kind">
          {marker ? KIND_LABEL[marker.kind] || "Target" : "Room"}
        </span>
        <span className="mobile-target-name">
          {marker ? marker.label : props.roomId}
        </span>
        <span className="mobile-status-sub">
          {marker ? props.roomId : "Whole room"}
          {props.demoMode ? " · demo data" : ""}
        </span>
      </div>

      <div className="mobile-status" data-status={status}>
        <span className="mobile-status-word">
          {status === "unknown" ? "No data" : STATUS_LABEL[status]}
        </span>
        <span className="mobile-status-sub">
          {room
            ? "Fused status: " + status + " · updated " + formatAgo(props.lastMessageAt, now)
            : isLive
            ? "Waiting for the first reading"
            : "Reconnecting — showing nothing yet"}
        </span>
      </div>

      {trendMinutes !== null && trend.metric ? (
        <div className="trend-banner" data-urgent={String(trendMinutes <= 15)}>
          <div className="trend-clock num">~{Math.max(0, Math.round(trendMinutes))} min</div>
          <div className="trend-copy">
            <div className="trend-headline">
              {sensorLabel(trend.metric)} heading for its threshold
            </div>
          </div>
        </div>
      ) : null}

      {isAnomaly ? (
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">Anomaly</span>
          </div>
          <div className="anomaly-state">
            <span className="anomaly-flag">Anomaly flagged</span>
          </div>
          {features.length > 0 ? (
            <p className="anomaly-features">
              Flagged by: <strong>{features.join(", ")}</strong>
            </p>
          ) : null}
          <p className="anomaly-caveat">
            A deviation score from an unsupervised model, not an accuracy or a
            probability.
          </p>
        </section>
      ) : null}

      <div className="mobile-readings">
        {readingKeys.map((key) => {
          const meta = SENSOR_META[key] || {};
          const value = sensors[key];
          const isMissing = value === null || value === undefined;
          return (
            <div className="mobile-reading" key={key}>
              <div className="mobile-reading-label">{meta.short || key}</div>
              <div>
                <span
                  className="mobile-reading-value num"
                  data-missing={String(isMissing)}
                >
                  {formatValue(key, value)}
                </span>
                {meta.unit ? (
                  <span className="mobile-reading-unit">{meta.unit}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {suggestions.length > 0 ? (
        <section className="panel">
          <div className="panel-head">
            <span className="microlabel">What to do</span>
          </div>
          <ul className="suggestion-list">
            {suggestions.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mobile-foot">
        EchoTwin · <a className="mobile-link" href="/">open the full dashboard</a>
        {AR_ENABLED ? " · camera view enabled" : ""}
      </div>
    </div>
  );

  return (
    <>
      <ToastStack toasts={props.toasts} onDismiss={props.onDismissToast} />
      <ArOverlay>{body}</ArOverlay>
    </>
  );
}
