from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest


FEATURE_NAMES = [
    "temperature",
    "humidity",
    "eco2",
    "tvoc",
    "aqi",
    "surface_temp",
    "vibration_magnitude",
    "vibration_trip",
]


def main():
    random = np.random.default_rng(42)
    sample_count = 3000

    training_data = np.column_stack(
        [
            np.clip(random.normal(25, 2, sample_count), 19, 29.5),
            np.clip(random.normal(50, 10, sample_count), 30, 70),
            np.clip(random.normal(600, 120, sample_count), 400, 950),
            np.clip(random.normal(120, 60, sample_count), 0, 280),
            np.clip(random.normal(2, 0.6, sample_count), 1, 3.8),
            np.clip(random.normal(30, 3, sample_count), 20, 39),
            np.clip(random.normal(1, 0.5, sample_count), 0, 2.4),
            random.binomial(1, 0.01, sample_count),
        ]
    )

    model = IsolationForest(
        n_estimators=200,
        contamination=0.05,
        random_state=42,
    )
    model.fit(training_data)

    artifact = {
        "model": model,
        "feature_names": FEATURE_NAMES,
        "means": training_data.mean(axis=0),
        "standard_deviations": training_data.std(axis=0),
    }
    destination = (
        Path(__file__).resolve().parents[1]
        / "backend"
        / "models"
        / "isolation_forest.joblib"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, destination)
    print("Saved anomaly model to", destination)


if __name__ == "__main__":
    main()
