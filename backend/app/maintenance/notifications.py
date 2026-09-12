"""At-most-one dispatch attempt per incident/mode, durable across worker restarts."""
import os
import re
from datetime import timedelta
from xml.sax.saxutils import escape

import httpx
from sqlalchemy import text
from app.db import engine


def provider_settings():
    sid = os.getenv("TWILIO_ACCOUNT_SID", "")
    token = os.getenv("TWILIO_AUTH_TOKEN", "")
    sender = os.getenv("TWILIO_FROM_NUMBER", "")
    recipient = os.getenv("MAINTENANCE_CALL_TO", "")
    if not re.fullmatch(r"AC[0-9a-fA-F]{32}", sid) or not token:
        raise ValueError("Twilio credentials are not configured")
    if not all(re.fullmatch(r"\+[1-9][0-9]{7,14}", number) for number in (sender, recipient)):
        raise ValueError("Configure one designated E.164 caller and recipient")
    return sid, token, sender, recipient


def dispatch(incident, settings, now):
    if settings.notification_mode == "disabled" or incident["severity"] != "critical":
        return
    mode = settings.notification_mode
    # Call text is deterministic evidence, never unconstrained LLM output.
    message = "EchoTwin incident {0} in {1}. {2}. Please inspect and acknowledge this incident in the dashboard.".format(
        incident["id"], incident["room_id"], incident["title"])
    credentials = None
    if mode == "twilio":
        credentials = provider_settings()  # invalid config must not make a request
    with engine.begin() as connection:
        current = connection.execute(text("SELECT status,condition_active FROM maintenance_incidents WHERE id=:id FOR UPDATE"), {"id": incident["id"]}).mappings().first()
        if not current or current["status"] != "open" or not current["condition_active"]:
            return
        # Global recipient cooldown as well as per-incident deduplication.
        latest = connection.execute(text("SELECT max(created_at) FROM maintenance_notifications WHERE mode=:mode"), {"mode": mode}).scalar_one()
        if latest and now - latest < timedelta(seconds=settings.cooldown_seconds):
            return
        row = connection.execute(text("""INSERT INTO maintenance_notifications
            (incident_id,mode,status,created_at,updated_at,message)
            VALUES (:id,:mode,:status,:now,:now,:message) ON CONFLICT(incident_id,mode) DO NOTHING RETURNING id"""),
            {"id": incident["id"], "mode": mode, "status": "dry_run" if mode == "dry_run" else "dispatching", "now": now, "message": message}).first()
    if row is None or mode == "dry_run":
        return
    notification_id = row.id
    # Mark before contacting provider. An ambiguous timeout is never retried automatically.
    sid, token, sender, recipient = credentials
    fields = {"id": notification_id, "now": now, "status": "unknown", "sid": None,
              "detail": "Delivery uncertain; inspect provider records. No automatic retry."}
    try:
        response = httpx.post("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Calls.json",
                              auth=(sid, token), data={"To": recipient, "From": sender,
                              "Twiml": "<Response><Say>" + escape(message) + "</Say></Response>"}, timeout=10)
        if 400 <= response.status_code < 500:
            fields.update(status="failed", detail="Provider rejected request: HTTP " + str(response.status_code))
        else:
            response.raise_for_status()
            payload = response.json()
            if not re.fullmatch(r"CA[0-9a-fA-F]{32}", payload.get("sid", "")):
                raise ValueError("Invalid provider call ID")
            fields.update(status="submitted", sid=payload["sid"], detail="Accepted by provider; not yet evidence of an answered call.")
    except Exception:
        pass
    with engine.begin() as connection:
        connection.execute(text("""UPDATE maintenance_notifications SET status=:status,provider_sid=:sid,
            updated_at=:now,detail=:detail WHERE id=:id"""), fields)


def reconcile(now):
    """Poll provider status; avoids requiring a publicly accessible callback URL."""
    with engine.connect() as connection:
        pending = connection.execute(text("""SELECT id,provider_sid FROM maintenance_notifications
            WHERE status IN ('submitted','queued','ringing','in-progress') AND provider_sid IS NOT NULL LIMIT 20""")).mappings().all()
    if not pending:
        return
    sid, token, _, _ = provider_settings()
    for row in pending:
        try:
            response = httpx.get("https://api.twilio.com/2010-04-01/Accounts/" + sid + "/Calls/" + row["provider_sid"] + ".json", auth=(sid, token), timeout=8)
            response.raise_for_status()
            status = response.json()["status"]
            if status not in ("queued", "ringing", "in-progress", "completed", "busy", "failed", "no-answer", "canceled"):
                continue
            with engine.begin() as connection:
                connection.execute(text("UPDATE maintenance_notifications SET status=:status,updated_at=:now WHERE id=:id"), {"status": status, "now": now, "id": row["id"]})
        except Exception:
            continue
