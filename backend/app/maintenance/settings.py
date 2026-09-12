import os
import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    review_seconds: int = 180
    window_seconds: int = 300
    urgent_seconds: int = 15
    warning_persistence: int = 120
    critical_persistence: int = 30
    sensor_stale_seconds: int = 30
    camera_stale_seconds: int = 30
    expected_sample_seconds: float = 1.0
    cooldown_seconds: int = 900
    rooms: tuple = ("corridor_a",)
    cameras: tuple = ("cam1", "cam2")
    notification_mode: str = "dry_run"
    use_llm: bool = True

    @classmethod
    def from_env(cls):
        integers = {
            "review_seconds": "MAINTENANCE_REVIEW_SECONDS",
            "window_seconds": "MAINTENANCE_WINDOW_SECONDS",
            "urgent_seconds": "MAINTENANCE_URGENT_SECONDS",
            "warning_persistence": "MAINTENANCE_WARNING_PERSISTENCE_SECONDS",
            "critical_persistence": "MAINTENANCE_CRITICAL_PERSISTENCE_SECONDS",
            "sensor_stale_seconds": "MAINTENANCE_SENSOR_STALE_SECONDS",
            "camera_stale_seconds": "MAINTENANCE_CAMERA_STALE_SECONDS",
            "cooldown_seconds": "MAINTENANCE_COOLDOWN_SECONDS",
        }
        defaults = cls()
        values = {key: int(os.getenv(env, str(getattr(defaults, key)))) for key, env in integers.items()}
        if any(value < 1 for value in values.values()):
            raise ValueError("Maintenance intervals must be positive")
        values["expected_sample_seconds"] = float(os.getenv("MAINTENANCE_SAMPLE_SECONDS", "1"))
        if not math.isfinite(values["expected_sample_seconds"]) or values["expected_sample_seconds"] <= 0:
            raise ValueError("MAINTENANCE_SAMPLE_SECONDS must be positive")
        if max(values["warning_persistence"], values["critical_persistence"]) > values["window_seconds"]:
            raise ValueError("Persistence periods cannot exceed the review window")
        for key, env, fallback in (("rooms", "MAINTENANCE_ROOMS", "corridor_a"), ("cameras", "MAINTENANCE_CAMERAS", "cam1,cam2")):
            values[key] = tuple(part.strip() for part in os.getenv(env, fallback).split(",") if part.strip())
        if not values["rooms"]:
            raise ValueError("Configure at least one maintenance room")
        values["notification_mode"] = os.getenv("MAINTENANCE_NOTIFICATION_MODE", "dry_run")
        if values["notification_mode"] not in ("dry_run", "disabled", "twilio"):
            raise ValueError("Notification mode must be dry_run, disabled, or twilio")
        values["use_llm"] = os.getenv("MAINTENANCE_USE_LLM", "1") == "1"
        return cls(**values)
