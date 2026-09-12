export type ReadingSource = "sensor" | "camera";

export interface Reading {
  source: ReadingSource;
  source_id: string;
  reading_type: string;
  value: number | string;
  confidence?: number;
  timestamp: string;
}

export interface BackendState {
  readings: Reading[];
  warnings?: string[];
  anomalies?: string[];
}

export type ConnectionStatus = "live" | "demo" | "error";

export type TrendDirection = "up" | "down" | "flat";

export type TrendMap = Record<string, TrendDirection>;

export function trendKey(sourceId: string, readingType: string): string {
  return `${sourceId}::${readingType}`;
}
