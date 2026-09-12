import { getSensorMeta } from "@/lib/sensorMeta";
import type { Reading, TrendDirection } from "@/lib/types";

interface SensorCardProps {
  reading: Reading;
  trend: TrendDirection;
  now: number;
}

const STALE_THRESHOLD_MS = 15_000;

const TREND_ICON: Record<TrendDirection, string> = { up: "▲", down: "▼", flat: "—" };
const TREND_COLOR: Record<TrendDirection, string> = {
  up: "text-emerald-400",
  down: "text-red-400",
  flat: "text-slate-500",
};

function formatValue(value: number | string): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toString() : value.toFixed(1);
  }
  return value;
}

export default function SensorCard({ reading, trend, now }: SensorCardProps) {
  const meta = getSensorMeta(reading.reading_type);
  const isStale = now - new Date(reading.timestamp).getTime() > STALE_THRESHOLD_MS;

  return (
    <div className="relative rounded-xl border border-white/10 bg-slate-900/60 p-4 shadow-sm">
      {isStale && (
        <span
          className="absolute right-3 top-3 h-2 w-2 rounded-full bg-amber-400"
          title="No update in the last 15s"
        />
      )}
      <div className="flex items-center gap-2 text-slate-400">
        <span className="text-xl leading-none">{meta.icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{meta.label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-white">{formatValue(reading.value)}</span>
        {meta.unit && <span className="text-sm text-slate-400">{meta.unit}</span>}
        <span className={`ml-auto text-lg ${TREND_COLOR[trend]}`}>{TREND_ICON[trend]}</span>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">{reading.source_id}</div>
    </div>
  );
}
