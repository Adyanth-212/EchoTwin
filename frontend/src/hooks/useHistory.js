import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "../config.js";

// Pulls bucketed time series out of the backend's TimescaleDB-backed history
// endpoints and re-polls on a timer. `sensor` is optional on the backend: if
// it is omitted every sensor for the room comes back in one mixed list, so
// points are always grouped by point.sensor here regardless.
//
// A failed or timed-out request never rejects into the caller. The hook keeps
// whatever it last had and reports `error`, so an unreachable /history
// degrades to "no history yet" instead of an unhandled rejection.

const POLL_INTERVAL_MS = 30000;

function groupBySensor(points) {
  const bySensor = {};
  if (!Array.isArray(points)) {
    return bySensor;
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const key = point.sensor;
    if (!key) {
      continue;
    }
    if (!bySensor[key]) {
      bySensor[key] = [];
    }
    bySensor[key].push(point);
  }
  return bySensor;
}

export default function useHistory(options) {
  const settings = options || {};
  const roomId = settings.roomId;
  const sensor = settings.sensor;
  const bucket = settings.bucket || "5m";
  const enabled = settings.enabled !== false;

  const [series, setSeries] = useState({});
  const [meta, setMeta] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!enabled || !roomId) {
      return;
    }

    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("room_id", roomId);
      params.set("bucket", bucket);
      if (sensor) {
        params.set("sensor", sensor);
      }

      const payload = await fetchJson(
        "/history/sensors?" + params.toString(),
        { timeoutMs: 10000 }
      );

      if (!mountedRef.current) {
        return;
      }
      setSeries(groupBySensor(payload.points));
      setMeta({
        from: payload.from,
        to: payload.to,
        bucket: payload.bucket,
        pointCount: payload.point_count,
      });
      setError(null);
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught.message || "unavailable");
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [roomId, sensor, bucket, enabled]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load, enabled]);

  return {
    series: series,
    meta: meta,
    isLoading: isLoading,
    error: error,
    reload: load,
  };
}

// Same treatment for the CV occupancy series, which lives on a separate
// endpoint with occupancy/max_occupancy instead of sensor/value.
export function useCvHistory(options) {
  const settings = options || {};
  const roomId = settings.roomId;
  const bucket = settings.bucket || "5m";
  const enabled = settings.enabled !== false;

  const [points, setPoints] = useState([]);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!enabled || !roomId) {
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set("room_id", roomId);
      params.set("bucket", bucket);

      const payload = await fetchJson(
        "/history/cv-events?" + params.toString(),
        { timeoutMs: 10000 }
      );

      if (!mountedRef.current) {
        return;
      }
      setPoints(Array.isArray(payload.points) ? payload.points : []);
      setError(null);
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught.message || "unavailable");
      }
    }
  }, [roomId, bucket, enabled]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [load, enabled]);

  return { points: points, error: error, reload: load };
}
