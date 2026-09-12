from pathlib import Path

import joblib
import numpy as np


MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "isolation_forest.joblib"


if MODEL_PATH.exists():
    artifact = joblib.load(MODEL_PATH)
else:
    artifact = None


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
