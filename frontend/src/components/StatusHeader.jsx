import { useEffect, useState } from "react";
import { STATUS_LABEL, formatAgo } from "../config.js";

const CONNECTION_COPY = {
  live: "Live",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  demo: "Demo feed",
};

// One-second tick purely for the "last update" readout. Nothing in the 3D
// scene depends on this, so it never causes a canvas re-render.
function useClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export default function StatusHeader(props) {
  const room = props.room;
  const status = room ? room.status : "unknown";
  const now = useClock();

  const connectionState = props.connectionState;
  const connectionLabel = CONNECTION_COPY[connectionState] || "Offline";

  return (
    <header className="header">
      <div className="header-identity">
        <div className="header-room">{props.roomId}</div>
        <div className="header-sub">
          {room
            ? "Fused from " + room.source + " · EchoTwin digital twin"
            : "Waiting for the first reading"}
        </div>
      </div>

      <div className="header-spacer" />

      <div className="header-meta">
        {props.demoMode ? (
          <span className="demo-badge" title="Synthetic readings, not live sensor data">
            Demo data
          </span>
        ) : null}

        <span className="status-pill" data-status={status}>
          <span className="status-pill-dot" />
          {status === "unknown" ? "No data" : STATUS_LABEL[status] + " · " + status}
        </span>

        <span className="conn" data-state={connectionState}>
          <span className="conn-dot" />
          {connectionLabel}
          {props.lastMessageAt ? (
            <span className="num" style={{ color: "var(--dim)" }}>
              {" · " + formatAgo(props.lastMessageAt, now)}
            </span>
          ) : null}
        </span>

        <button
          type="button"
          className="icon-toggle"
          data-on={String(props.soundEnabled)}
          onClick={props.onToggleSound}
          title={
            props.soundEnabled
              ? "Alert tone is on — click to mute"
              : "Alert tone is muted — click to unmute"
          }
        >
          {props.soundEnabled ? "Sound on" : "Sound muted"}
        </button>
      </div>
    </header>
  );
}
