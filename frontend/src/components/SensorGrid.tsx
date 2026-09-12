import SensorCard from "./SensorCard";
import type { Reading, TrendMap } from "@/lib/types";
import { trendKey } from "@/lib/types";

interface SensorGridProps {
  readings: Reading[];
  trends: TrendMap;
  now: number;
}

export default function SensorGrid({ readings, trends, now }: SensorGridProps) {
  const sensorReadings = readings.filter((reading) => reading.source !== "camera");

  if (sensorReadings.length === 0) {
    return <p className="text-sm text-slate-500">No sensor readings yet.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      {sensorReadings.map((reading) => (
        <SensorCard
          key={`${reading.source_id}-${reading.reading_type}`}
          reading={reading}
          trend={trends[trendKey(reading.source_id, reading.reading_type)] ?? "flat"}
          now={now}
        />
      ))}
    </div>
  );
}
