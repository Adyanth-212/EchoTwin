import { useEffect, useState } from "react";
import { API_BASE, DEMO_MODE } from "../config.js";

async function request(path, method = "GET", body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(API_BASE + "/maintenance" + path, {
      method, signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error("Maintenance request failed (" + response.status + ")");
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function timeLabel(value) {
  return value ? new Date(value).toLocaleTimeString() : "Not yet";
}

function freshnessLabel(metric) {
  if (metric.sample_age_seconds === null) return "No samples";
  return Math.round(metric.sample_age_seconds) + "s old";
}

export default function MaintenancePanel({ roomId }) {
  const [state, setState] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    if (DEMO_MODE) return undefined;
    let cancelled = false;
    let timer;
    async function load() {
      try {
        const [status, result] = await Promise.all([
          request("/status"), request("/incidents?room_id=" + encodeURIComponent(roomId)),
        ]);
        if (!cancelled) {
          setState(status);
          setIncidents(result.incidents);
          setError("");
        }
      } catch (caught) {
        if (!cancelled) setError("Maintenance service unavailable — last fetched results may be outdated.");
      }
      if (!cancelled) timer = setTimeout(load, 5000);
    }
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [roomId, revision]);

  async function act(path, body = {}) {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      await request(path, "POST", body);
      setMessage(path === "/review" ? "Review queued for the worker." : "Incident updated.");
      setRevision(value => value + 1);
    } catch (caught) {
      setMessage(caught.message);
    } finally {
      setPending(false);
    }
  }

  const snapshot = state && (state.snapshots || []).find(item => item.room_id === roomId);
  const sources = snapshot ? { ...snapshot.evidence.sensors, ...snapshot.evidence.cameras } : {};
  const active = incidents.filter(item => item.status !== "resolved");
  const shown = showResolved ? incidents : active;

  return (
    <section className="panel maintenance-panel" aria-label="Maintenance watcher">
      <div className="panel-head">
        <span className="microlabel">Maintenance watcher</span>
        <span className="source-badge">{DEMO_MODE ? "Demo paused" : state ? (state.mode === "dry_run" ? "Dry run · no calls" : state.mode === "twilio" ? "Calls enabled" : "Calls disabled") : "Connecting"}</span>
      </div>
      {DEMO_MODE ? <p className="panel-empty">The watcher uses stored real readings. It is paused in this browser's synthetic demo view.</p> : <>
        <p className="maintenance-summary">
          {state ? (state.running ? "Worker running" : "Worker not reporting") : "Checking worker"}
          {state ? " · reviews every " + Math.round(state.review_seconds / 60) + " min" : ""}
          <br />Last full review: {timeLabel(state && state.last_review_at)}
          {state && state.error ? <><br /><span role="alert">{state.error}</span></> : null}
        </p>
        {error ? <p role="alert" className="maintenance-error">{error}</p> : null}
        <div className="maintenance-actions">
          <button className="icon-toggle" disabled={pending || !state || !state.running} onClick={() => act("/review")}>Review now</button>
          <button className="icon-toggle" onClick={() => setShowResolved(value => !value)}>{showResolved ? "Show active" : "Show history"}</button>
          <span>{active.length} active</span>
        </div>
        {message ? <p role="status" className="maintenance-summary">{message}</p> : null}
        {snapshot ? <details className="maintenance-detail">
          <summary>Source freshness · measured at {timeLabel(snapshot.reviewed_at)}</summary>
          <div className="maintenance-sources">{Object.entries(sources).map(([name, metric]) => (
            <div key={name} data-fresh={String(metric.fresh)}>
              <span>{name.replaceAll("_", " ")}</span>
              <span>{metric.fresh ? "Fresh" : "Stale / missing"} · {freshnessLabel(metric)}</span>
            </div>
          ))}</div>
          <p className="maintenance-summary">Ages reflect the last full review, not a live stopwatch. Sample times and receipt times are checked separately.</p>
        </details> : null}
        {shown.length === 0 ? <p className="panel-empty">{state && state.last_review_at ? "No incidents in this view." : "Waiting for the first maintenance review."}</p> : null}
        <div className="maintenance-list" tabIndex={0} aria-label="Maintenance incidents">
        {shown.map(incident => (
          <article className="maintenance-incident" data-severity={incident.severity} key={incident.id}>
            <div className="maintenance-title"><strong>#{incident.id} · {incident.title}</strong><span>{incident.severity}</span></div>
            <p className="maintenance-summary">{incident.status} · {incident.condition_active ? "condition observed" : "condition cleared; confirm resolution"} · {timeLabel(incident.opened_at)}</p>
            <p className="maintenance-summary">Action: {incident.action.replaceAll("_", " ")} · occurrence {incident.recurrence_count} in 24h</p>
            {incident.advice ? <>
              <span className="source-badge">{incident.advice_source === "ollama" ? "Qwen inspection suggestion" : "Rule-based guidance"}</span>
              <p>{incident.advice.summary}</p>
              <ul>{incident.advice.inspection_steps.map((step, index) => <li key={index}>{step}</li>)}</ul>
              {incident.advice.missing_information.length ? <p className="maintenance-summary">Unverified: {incident.advice.missing_information.join(" ")}</p> : null}
            </> : <p className="maintenance-summary">Verify the source and inspect the affected equipment. Detailed guidance is pending.</p>}
            <details className="maintenance-detail"><summary>Detection evidence</summary><pre>{JSON.stringify(incident.evidence, null, 2)}</pre></details>
            {(incident.notifications || []).map(notification => (
              <div className="maintenance-notification" key={notification.id}>
                <strong>{notification.status === "dry_run" ? "Would call maintenance (dry run)" : "Call: " + notification.status}</strong>
                <p>{notification.message}</p>
                {notification.detail ? <p className="maintenance-summary">{notification.detail}</p> : null}
                {notification.status === "completed" ? <p className="maintenance-summary">Call ended; acknowledgement must still be recorded here.</p> : null}
              </div>
            ))}
            {incident.status !== "resolved" ? <div className="maintenance-actions">
              {incident.status === "open" ? <button className="icon-toggle" disabled={pending} onClick={() => act("/incidents/" + incident.id + "/acknowledge")}>Acknowledge</button> : null}
              <button className="icon-toggle" disabled={pending} onClick={() => act("/incidents/" + incident.id + "/resolve")}>Resolve</button>
            </div> : null}
          </article>
        ))}
        </div>
        <p className="maintenance-summary">Inspection suggestions require human judgement. Replacement is not authorized by a model response.</p>
      </>}
    </section>
  );
}
