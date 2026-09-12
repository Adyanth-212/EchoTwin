from datetime import datetime, timedelta, timezone

from app import config


def sensor_timestamp_rejection_reason(timestamp, current_time=None):
    if current_time is None:
        current_time = datetime.now(timezone.utc)

    timestamp = timestamp.astimezone(timezone.utc)
    current_time = current_time.astimezone(timezone.utc)

    oldest_allowed = current_time - timedelta(
        seconds=config.SENSOR_TIMESTAMP_MAX_AGE_SECONDS
    )
    newest_allowed = current_time + timedelta(
        seconds=config.SENSOR_TIMESTAMP_FUTURE_TOLERANCE_SECONDS
    )

    if timestamp < oldest_allowed:
        return (
            "timestamp is more than "
            + str(config.SENSOR_TIMESTAMP_MAX_AGE_SECONDS)
            + " seconds old"
        )

    if timestamp > newest_allowed:
        return (
            "timestamp is more than "
            + str(config.SENSOR_TIMESTAMP_FUTURE_TOLERANCE_SECONDS)
            + " seconds in the future"
        )

    return None
