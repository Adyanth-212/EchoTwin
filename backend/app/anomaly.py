from pathlib import Path

import joblib
import numpy as np

from app import config


# What a room full of people plausibly drives up on its own: exhaled CO2,
# VOCs, the AQI derived from both, and humidity from respiration.
#
# Air temperature is deliberately absent even though bodies do warm a room,
# because it is also the primary signal for equipment overheating and half of
# the combined heat-and-vibration critical rule. Suppressing it because the
# room is busy is the one mistake here with real consequences.
AIR_QUALITY_FEATURES = frozenset(["eco2", "tvoc", "aqi", "humidity"])


MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "isolation_forest.joblib"


if MODEL_PATH.exists():
    artifact = joblib.load(MODEL_PATH)
else:
    artifact = None


def occupancy_explains_anomaly(top_features, occupancy):
    """True when a busy room accounts for everything the model flagged.

    The model has no occupancy feature and was trained on independently
    sampled data, so it cannot tell "crowded" from "faulty" — a full room
    pushing CO2 past the baseline scores the same as a real fault. This is the
    cross-check that separates them.

    Every contributing feature must be one people explain. A single vibration
    or surface-temperature contributor means the crowd is not the whole story
    and the anomaly stands.
    """
    if not top_features:
        return False
    if occupancy is None or occupancy < config.OCCUPANCY_EXPLAINS_AIR_MIN_PEOPLE:
        return False

    for feature in top_features:
        if feature not in AIR_QUALITY_FEATURES:
            return False
    return True


def evaluate_anomaly(sensors):
    if artifact is None:
        return False, None, []

    feature_names = artifact["feature_names"]
    values = []

    for feature in feature_names:
        value = sensors.get(feature)
        if value is None:
            return False, None, []
        values.append(float(value))

    sample = np.array([values])
    prediction = artifact["model"].predict(sample)[0]
    score = -float(artifact["model"].decision_function(sample)[0])
    is_anomaly = bool(prediction == -1)

    top_features = []
    if is_anomaly:
        means = np.asarray(artifact["means"])
        standard_deviations = np.asarray(artifact["standard_deviations"])
        deviations = np.abs((sample[0] - means) / standard_deviations)
        indexes = np.argsort(deviations)[-2:][::-1]
        top_features = [feature_names[index] for index in indexes]

    return is_anomaly, round(score, 4), top_features
