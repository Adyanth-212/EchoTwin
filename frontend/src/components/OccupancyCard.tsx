import type { Reading } from "@/lib/types";

interface OccupancyCardProps {
  readings: Reading[];
}

function isOccupied(value: number | string): boolean {
  if (typeof value === "string") return value.toLowerCase().includes("occup");
  return value > 0;
}

export default function OccupancyCard({ readings }: OccupancyCardProps) {
  const cameraReadings = readings.filter((reading) => reading.source === "camera");
  const latest = cameraReadings[cameraReadings.length - 1];

  if (!latest) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Occupancy</h3>
        <p className="mt-3 text-sm text-slate-500">No camera data yet.</p>
      </div>
    );
  }

  const occupied = isOccupied(latest.value);
  const confidencePct = latest.confidence != null ? Math.round(latest.confidence * 100) : null;

  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Occupancy</h3>
      <div className="mt-3 flex items-center gap-3">
        <span className={`h-3 w-3 rounded-full ${occupied ? "bg-cyan-400" : "bg-slate-600"}`} />
        <span className="text-2xl font-semibold text-white">{occupied ? "Occupied" : "Vacant"}</span>
      </div>
      {confidencePct != null && (
        <p className="mt-2 text-sm text-slate-400">{confidencePct}% confidence</p>
      )}
      <p className="mt-3 text-[11px] text-slate-500">{latest.source_id}</p>
    </div>
  );
}
