"use client";

import { useEchoTwinState } from "@/hooks/useEchoTwinState";
import { useNow } from "@/hooks/useNow";
import Header from "./Header";
import SensorGrid from "./SensorGrid";
import OccupancyCard from "./OccupancyCard";
import AlertBanners from "./AlertBanners";
import ChatPanel from "./ChatPanel";

export default function Dashboard() {
  const { readings, warnings, anomalies, status, lastUpdated, trends } = useEchoTwinState();
  const now = useNow();

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <Header status={status} lastUpdated={lastUpdated} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-6">
        <AlertBanners warnings={warnings} anomalies={anomalies} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Sensors</h2>
            <SensorGrid readings={readings} trends={trends} now={now} />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Camera</h2>
            <OccupancyCard readings={readings} />
          </section>
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">Ask the Twin</h2>
          <ChatPanel />
        </section>
      </main>
    </div>
  );
}
