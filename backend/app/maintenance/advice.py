import json

import httpx
from pydantic import BaseModel, Field
from app import config


class InspectionAdvice(BaseModel):
    summary: str = Field(min_length=1, max_length=600)
    inspection_steps: list[str] = Field(min_length=1, max_length=5)
    missing_information: list[str] = Field(default_factory=list, max_length=5)


def explain(incident, snapshot, settings):
    if incident["action"] == "inspect_connection":
        steps = ["Check power, wiring and the source process.", "Confirm incoming sample timestamps before interpreting the readings."]
    else:
        steps = ["Verify the reading and sensor mounting against a reference before diagnosing equipment.",
                 "Inspect the affected equipment and record the findings."]
    if incident["action"] == "deeper_inspection":
        steps.append("Arrange a deeper inspection because the condition has recurred. Consider replacement only after a technician confirms a fault.")
    fallback = {"summary": incident["title"], "inspection_steps": steps,
                "missing_information": ["Verified equipment fault, service history and manufacturer limits are not provided."]}
    if not settings.use_llm or not config.TAILSCALE_OLLAMA_URL:
        return fallback, "rules"
    prompt = (
        "You assist facility maintenance. Explain only the supplied evidence. "
        "Return JSON matching the schema. Suggest checks, not a confirmed diagnosis. "
        "Never recommend unconditional replacement; replacement requires technician confirmation. "
        "Do not invent measurements, addresses, equipment types, or maintenance history. "
        "If suggesting a check of equipment not identified in the evidence, explicitly say 'if present'. "
        "Stale samples are not proof of healthy or faulty equipment. eCO2 is an estimate. "
        "The anomaly baseline is synthetic. No calls, severity changes, or actions are yours to authorize. "
        "Keep steps short, specific, and no more than five.\n"
        + json.dumps({"incident": {key: incident[key] for key in ("title", "severity", "action", "recurrence_count", "evidence")},
                      "window": snapshot}, default=str)
    )
    try:
        response = httpx.post(config.TAILSCALE_OLLAMA_URL.rstrip("/") + "/api/generate", json={
            "model": config.OLLAMA_MODEL, "prompt": prompt, "stream": False, "think": False,
            "format": InspectionAdvice.model_json_schema(), "options": {"num_predict": 400},
        }, timeout=config.OLLAMA_TIMEOUT_SECONDS)
        response.raise_for_status()
        advice = InspectionAdvice.model_validate_json(response.json()["response"])
        result = advice.model_dump()
        # Keep the known limitations visible even if the model omits them.
        result["missing_information"] = list(dict.fromkeys(fallback["missing_information"] + result["missing_information"]))[:5]
        return result, "ollama"
    except Exception:
        return fallback, "rules"
