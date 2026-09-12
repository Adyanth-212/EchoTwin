"use client";

import { useEffect, useRef, useState } from "react";
import { getDemoState } from "@/lib/demoData";
import type { BackendState, ConnectionStatus, Reading, TrendMap } from "@/lib/types";
import { trendKey } from "@/lib/types";

const POLL_INTERVAL_MS = 2500;

export interface EchoTwinState {
  readings: Reading[];
  warnings: string[];
  anomalies: string[];
  status: ConnectionStatus;
  lastUpdated: Date | null;
  trends: TrendMap;
}

function isBackendState(value: unknown): value is BackendState {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { readings?: unknown }).readings)
  );
}

export function useEchoTwinState(): EchoTwinState {
  const [state, setState] = useState<EchoTwinState>({
    readings: [],
    warnings: [],
    anomalies: [],
    status: "demo",
    lastUpdated: null,
    trends: {},
  });

  // Keeps the last 2 numeric values per (source_id, reading_type) so trend
  // arrows survive across polls without re-triggering the effect.
  const historyRef = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    let cancelled = false;

    function computeTrends(readings: Reading[]): TrendMap {
      const trends: TrendMap = {};
      for (const reading of readings) {
        if (typeof reading.value !== "number") continue;
        const key = trendKey(reading.source_id, reading.reading_type);
        const history = historyRef.current.get(key) ?? [];
        const updated = [...history, reading.value].slice(-2);
        historyRef.current.set(key, updated);

        if (updated.length < 2) {
          trends[key] = "flat";
        } else {
          const [previous, current] = updated;
          trends[key] = current > previous ? "up" : current < previous ? "down" : "flat";
        }
      }
      return trends;
    }

    function applyDemo(status: ConnectionStatus) {
      if (cancelled) return;
      const demo = getDemoState();
      setState({
        readings: demo.readings,
        warnings: demo.warnings ?? [],
        anomalies: demo.anomalies ?? [],
        status,
        lastUpdated: new Date(),
        trends: computeTrends(demo.readings),
      });
    }

    async function poll() {
      let response: Response;
      try {
        response = await fetch("/api/state", { cache: "no-store" });
      } catch {
        // Proxy/network unreachable entirely — expected before the backend is up.
        applyDemo("demo");
        return;
      }

      if (!response.ok) {
        applyDemo("demo");
        return;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        // Backend responded but body wasn't valid JSON.
        applyDemo("error");
        return;
      }

      if (!isBackendState(data)) {
        // Backend responded but the shape didn't match the contract.
        applyDemo("error");
        return;
      }

      if (cancelled) return;
      setState({
        readings: data.readings,
        warnings: data.warnings ?? [],
        anomalies: data.anomalies ?? [],
        status: "live",
        lastUpdated: new Date(),
        trends: computeTrends(data.readings),
      });
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return state;
}
