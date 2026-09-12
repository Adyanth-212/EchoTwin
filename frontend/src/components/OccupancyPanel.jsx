import { useEffect, useRef, useState } from "react";
import { DEMO_MODE, fetchJson, formatAgo } from "../config.js";
import { useCvHistory } from "../hooks/useHistory.js";
import Sparkline from "./Sparkline.jsx";

const POLL_INTERVAL_MS = 10000;

// Latest reading per camera, newest first from /cv-events. Raw CV events use
// `time` rather than `timestamp`, unlike the history endpoints.
function latestPerCamera(events) {
  const byCamera = {};
  if (!Array.isArray(events)) {
    return byCamera;
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const cameraId = event.camera_id;
    if (!cameraId || byCamera[cameraId]) {
      continue;
    }
    byCamera[cameraId] = {
      occupancy: event.occupancy,
      unusual: Boolean(event.unusual_activity),
      at: new Date(event.time || event.timestamp).getTime(),
    };
  }
  return byCamera;
}

export function useCameraEvents(enabled) {
  const [byCamera, setByCamera] = useState({});
  const [hasData, setHasData] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    async function load() {
      try {
        const events = await fetchJson("/cv-events?limit=40", {
          timeoutMs: 6000,
        });
        if (!mountedRef.current) {
          return;
        }
        const latest = latestPerCamera(events);
        setByCamera(latest);
        setHasData(Array.isArray(events) && events.length > 0);
      } catch (caught) {
        // Keep the last known camera readings on screen.
      }
    }

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  return { byCamera: byCamera, hasData: hasData };
}

export default function OccupancyPanel(props) {
  const sensors = (props.room && props.room.sensors) || {};
  const count = sensors.occupancy_count;

  const cvHistory = useCvHistory({
    roomId: props.roomId,
    bucket: "5m",
    enabled: !DEMO_MODE,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const cameras = Object.keys(props.cameraEvents || {});
  const hasCameraData = cameras.length > 0;

  const historyPoints = DEMO_MODE
    ? (props.liveHistory && props.liveHistory.occupancy_count) || []
    : cvHistory.points.map((point) => ({
        t: new Date(point.timestamp).getTime(),
        v: Number(point.occupancy),
      }));

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">Occupancy</span>
        <span className="microlabel">YOLOv8 · person class</span>
      </div>

      {count === null || count === undefined ? (
        <p className="panel-empty">
          No camera data yet — start the CV producer on a camera laptop.
        </p>
      ) : (
        <div className="occupancy-top">
          <span className="occupancy-count num">{count}</span>
          <span className="microlabel">
            {count === 1 ? "person in room" : "people in room"}
          </span>
        </div>
      )}

      {hasCameraData ? (
        <div className="camera-rows">
          {cameras.map((cameraId) => {
            const entry = props.cameraEvents[cameraId];
            return (
              <div className="camera-row" key={cameraId}>
                <span className="camera-name">{cameraId}</span>
                {entry.unusual ? (
                  <span className="camera-unusual">unusual activity</span>
                ) : null}
                <span className="camera-value num">{entry.occupancy}</span>
                <span className="camera-age">{formatAgo(entry.at, now)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="panel-empty">No per-camera events received yet.</p>
      )}

      {historyPoints.length >= 2 ? (
        <div style={{ marginTop: 14 }}>
          <Sparkline points={historyPoints} sensorKey="occupancy_count" />
        </div>
      ) : null}
    </section>
  );
}
