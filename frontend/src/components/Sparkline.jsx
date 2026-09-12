import { SENSOR_META, formatValue } from "../config.js";

// Hand-rolled SVG line chart — no chart library.
//
// One scale does all the work: the same x()/y() pair positions the line, the
// area fill, the threshold rule, the end dot and every label, so nothing can
// drift out of alignment. The y domain always includes the sensor's warning
// threshold, which is the point of drawing it: a reader should be able to see
// how far the current value is from the line that matters, not just that the
// series wiggled.

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 170;

// Generous padding so the outermost labels are never clipped by the viewBox.
const PAD_LEFT = 52;
const PAD_RIGHT = 74;
const PAD_TOP = 16;
const PAD_BOTTOM = 26;

function formatClock(timestampMs) {
  const date = new Date(timestampMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return hours + ":" + minutes;
}

export default function Sparkline(props) {
  const sensorKey = props.sensorKey;
  const meta = SENSOR_META[sensorKey] || {};

  const points = (props.points || []).filter(
    (point) =>
      point &&
      point.v !== null &&
      point.v !== undefined &&
      !Number.isNaN(Number(point.v))
  );

  if (points.length < 2) {
    return (
      <p className="panel-empty">
        Not enough history yet for {meta.label || sensorKey}.
      </p>
    );
  }

  let minValue = points[0].v;
  let maxValue = points[0].v;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].v < minValue) {
      minValue = points[index].v;
    }
    if (points[index].v > maxValue) {
      maxValue = points[index].v;
    }
  }

  const dataMin = minValue;
  const dataMax = maxValue;

  const threshold = meta.warn;
  let domainMin = dataMin;
  let domainMax = dataMax;

  if (threshold !== undefined) {
    domainMin = Math.min(domainMin, threshold);
    domainMax = Math.max(domainMax, threshold);
  }
  if (meta.chartMax !== undefined) {
    domainMax = Math.max(domainMax, meta.chartMax);
  }

  // A completely flat series would divide by zero; give it a little room.
  if (domainMax === domainMin) {
    domainMax = domainMin + 1;
  }

  const headroom = (domainMax - domainMin) * 0.08;
  domainMin = domainMin - headroom;
  domainMax = domainMax + headroom;

  const firstTime = points[0].t;
  const lastTime = points[points.length - 1].t;
  const timeSpan = lastTime - firstTime || 1;

  const plotWidth = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;

  function x(timestampMs) {
    return PAD_LEFT + ((timestampMs - firstTime) / timeSpan) * plotWidth;
  }

  function y(value) {
    const ratio = (value - domainMin) / (domainMax - domainMin);
    return PAD_TOP + (1 - ratio) * plotHeight;
  }

  const lineCommands = [];
  for (let index = 0; index < points.length; index += 1) {
    const command = index === 0 ? "M" : "L";
    lineCommands.push(
      command + x(points[index].t).toFixed(2) + " " + y(points[index].v).toFixed(2)
    );
  }
  const linePath = lineCommands.join(" ");

  const areaPath =
    linePath +
    " L" +
    x(lastTime).toFixed(2) +
    " " +
    (PAD_TOP + plotHeight).toFixed(2) +
    " L" +
    x(firstTime).toFixed(2) +
    " " +
    (PAD_TOP + plotHeight).toFixed(2) +
    " Z";

  const lastPoint = points[points.length - 1];
  const lastX = x(lastPoint.t);
  const lastY = y(lastPoint.v);

  const axisText = {
    fill: "var(--dim)",
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <svg
      className="spark"
      viewBox={"0 0 " + VIEW_WIDTH + " " + VIEW_HEIGHT}
      role="img"
      aria-label={
        (meta.label || sensorKey) +
        " over time, currently " +
        formatValue(sensorKey, lastPoint.v) +
        " " +
        (meta.unit || "")
      }
    >
      <defs>
        <linearGradient id={"spark-fill-" + sensorKey} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Baseline */}
      <line
        x1={PAD_LEFT}
        y1={PAD_TOP + plotHeight}
        x2={PAD_LEFT + plotWidth}
        y2={PAD_TOP + plotHeight}
        style={{ stroke: "var(--hairline)", strokeWidth: 1, fill: "none" }}
      />

      {/* Warning threshold from config.js — the line the reader cares about */}
      {threshold !== undefined ? (
        <g>
          <line
            x1={PAD_LEFT}
            y1={y(threshold)}
            x2={PAD_LEFT + plotWidth}
            y2={y(threshold)}
            style={{
              stroke: "var(--yellow)",
              strokeWidth: 1,
              strokeDasharray: "4 4",
              opacity: 0.55,
              fill: "none",
            }}
          />
          <text
            x={PAD_LEFT + plotWidth + 6}
            y={y(threshold) + 4}
            style={{
              fill: "var(--yellow)",
              fontSize: "10px",
              opacity: 0.85,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            warn {threshold}
          </text>
        </g>
      ) : null}

      <path d={areaPath} style={{ fill: "url(#spark-fill-" + sensorKey + ")" }} />

      <path
        d={linePath}
        style={{
          fill: "none",
          stroke: "var(--accent)",
          strokeWidth: 1.9,
          strokeLinejoin: "round",
          strokeLinecap: "round",
        }}
      />

      {/* Latest reading, emphasised and printed */}
      <circle
        cx={lastX}
        cy={lastY}
        r="3.6"
        style={{ fill: "var(--accent)", stroke: "var(--panel)", strokeWidth: 1.5 }}
      />
      <text
        x={lastX + 8}
        y={lastY + 4}
        style={{
          fill: "var(--text)",
          fontSize: "12px",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatValue(sensorKey, lastPoint.v)}
      </text>

      {/* Y labels name values the line actually reaches */}
      <text x={PAD_LEFT - 8} y={y(dataMax) + 4} textAnchor="end" style={axisText}>
        {formatValue(sensorKey, dataMax)}
      </text>
      {dataMin !== dataMax ? (
        <text x={PAD_LEFT - 8} y={y(dataMin) + 4} textAnchor="end" style={axisText}>
          {formatValue(sensorKey, dataMin)}
        </text>
      ) : null}

      {/* X labels are the first and last timestamps in the series */}
      <text x={PAD_LEFT} y={VIEW_HEIGHT - 8} style={axisText}>
        {formatClock(firstTime)}
      </text>
      <text
        x={PAD_LEFT + plotWidth}
        y={VIEW_HEIGHT - 8}
        textAnchor="end"
        style={axisText}
      >
        {formatClock(lastTime)}
      </text>
    </svg>
  );
}
