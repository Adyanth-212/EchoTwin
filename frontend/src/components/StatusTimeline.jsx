import { useMemo } from "react";
import { STATUS_LABEL } from "../config.js";
import { formatClock } from "../chartUtils.js";

// A band of the room's fused status over time, plus a marker wherever the
// anomaly detector fired.
//
// The status colours are used here for the one thing they are reserved for —
// state — and never carry identity anywhere else. They are also never the
// only encoding: every segment is labelled in the summary beneath and
// reachable by hover, so the band is readable without relying on colour.
//
// The backend keeps only the current room_status row, with no history
// endpoint behind it, so this is what this session has observed. It says so
// rather than implying it reaches further back than it does.

const VIEW_WIDTH = 760;
const BAND_HEIGHT = 26;
const MARKER_HEIGHT = 10;
const VIEW_HEIGHT = BAND_HEIGHT + MARKER_HEIGHT + 20;

const STATUS_COLOR = {
  green: "var(--green)",
  yellow: "var(--yellow)",
  red: "var(--red)",
};

// Collapse consecutive identical statuses into segments.
function toSegments(entries) {
  const segments = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const last = segments[segments.length - 1];
    if (last && last.status === entry.status) {
      last.end = entry.t;
    } else {
      segments.push({ status: entry.status, start: entry.t, end: entry.t });
    }
  }
  return segments;
}

export default function StatusTimeline(props) {
  const entries = props.entries || [];

  const model = useMemo(() => {
    if (entries.length < 2) {
      return null;
    }
    const start = entries[0].t;
    const end = entries[entries.length - 1].t;
    const span = end - start || 1;

    const segments = toSegments(entries);
    const anomalies = entries.filter((entry) => entry.isAnomaly);

    const counts = { green: 0, yellow: 0, red: 0 };
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (counts[segment.status] !== undefined) {
        counts[segment.status] += 1;
      }
    }

    return {
      start: start,
      end: end,
      span: span,
      segments: segments,
      anomalies: anomalies,
      counts: counts,
    };
  }, [entries]);

  if (model === null) {
    return (
      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">Status timeline</span>
        </div>
        <p className="panel-empty">
          Waiting for updates — the timeline builds as messages arrive.
        </p>
      </section>
    );
  }

  function xFor(time) {
    return ((time - model.start) / model.span) * VIEW_WIDTH;
  }

  const changes = model.segments.length - 1;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">Status timeline</span>
        <span className="microlabel">this session</span>
      </div>

      <svg
        className="spark"
        viewBox={"0 0 " + VIEW_WIDTH + " " + VIEW_HEIGHT}
        role="img"
        aria-label={
          "Room status over this session: " +
          changes +
          " changes, " +
          model.anomalies.length +
          " anomaly readings"
        }
      >
        {model.segments.map((segment, index) => {
          const startX = xFor(segment.start);
          const endX = index === model.segments.length - 1
            ? VIEW_WIDTH
            : xFor(model.segments[index + 1].start);
          return (
            <rect
              key={"seg-" + index}
              x={startX}
              y={0}
              // A 2px surface gap between adjacent fills rather than a border.
              width={Math.max(1, endX - startX - 2)}
              height={BAND_HEIGHT}
              rx="2"
              style={{ fill: STATUS_COLOR[segment.status] || "var(--dim)", opacity: 0.85 }}
            >
              <title>
                {STATUS_LABEL[segment.status] || segment.status} from{" "}
                {formatClock(segment.start)}
              </title>
            </rect>
          );
        })}

        {/* Anomaly ticks, below the band so they never obscure the state. */}
        {model.anomalies.map((entry, index) => (
          <rect
            key={"anom-" + index}
            x={Math.max(0, xFor(entry.t) - 1)}
            y={BAND_HEIGHT + 5}
            width="2"
            height={MARKER_HEIGHT - 4}
            style={{ fill: "var(--text)", opacity: 0.75 }}
          >
            <title>Anomaly flagged at {formatClock(entry.t)}</title>
          </rect>
        ))}

        <text
          x={0}
          y={VIEW_HEIGHT - 4}
          style={{ fill: "var(--dim)", fontSize: "11px", fontVariantNumeric: "tabular-nums" }}
        >
          {formatClock(model.start)}
        </text>
        <text
          x={VIEW_WIDTH}
          y={VIEW_HEIGHT - 4}
          textAnchor="end"
          style={{ fill: "var(--dim)", fontSize: "11px", fontVariantNumeric: "tabular-nums" }}
        >
          {formatClock(model.end)}
        </text>
      </svg>

      <div className="chart-legend">
        <span className="chart-legend-item">
          <span className="chart-swatch" style={{ background: "var(--green)" }} />
          Normal
        </span>
        <span className="chart-legend-item">
          <span className="chart-swatch" style={{ background: "var(--yellow)" }} />
          Watch
        </span>
        <span className="chart-legend-item">
          <span className="chart-swatch" style={{ background: "var(--red)" }} />
          Critical
        </span>
        <span className="chart-legend-item">
          <span
            className="chart-swatch"
            style={{ background: "var(--text)", width: 2 }}
          />
          Anomaly flagged
        </span>
      </div>

      <div className="chart-readout">
        <span>
          {changes === 0
            ? "No status changes this session."
            : changes === 1
            ? "1 status change this session."
            : changes + " status changes this session."}
          {model.anomalies.length > 0
            ? " " + model.anomalies.length + " readings flagged by the detector."
            : ""}
        </span>
      </div>
    </section>
  );
}
