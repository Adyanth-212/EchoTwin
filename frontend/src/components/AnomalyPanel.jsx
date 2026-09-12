import { sensorLabel } from "../config.js";

// The score shown here is the Isolation Forest's raw deviation score. It is
// not an accuracy, a confidence or a probability: the model is unsupervised
// and there is no labelled fault data to validate it against. The wording
// below is deliberate — calling it a confidence would be a factual error
// about what the model produces, not a stylistic choice.
//
// Direction matters too. sklearn's decision_function is NEGATIVE for
// outliers, but backend/app/anomaly.py negates it, so here a HIGHER score
// means further from baseline. Confirmed against live data: the real
// backend reports is_anomaly true with score +0.0216.
export default function AnomalyPanel(props) {
  const anomaly = (props.room && props.room.anomaly) || null;
  const isAnomaly = Boolean(anomaly && anomaly.is_anomaly);
  const features = anomaly && Array.isArray(anomaly.top_features)
    ? anomaly.top_features
    : [];

  const featureLabels = features.map((key) => sensorLabel(key).toLowerCase());

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">Anomaly detection</span>
        <span className="microlabel">Isolation Forest</span>
      </div>

      {!anomaly ? (
        <p className="panel-empty">No anomaly evaluation yet.</p>
      ) : (
        <div>
          <div className="anomaly-state">
            <span className={isAnomaly ? "anomaly-flag" : "anomaly-clear"}>
              {isAnomaly ? "Anomaly flagged" : "Nothing unusual"}
            </span>
          </div>

          {isAnomaly && featureLabels.length > 0 ? (
            <p className="anomaly-features">
              Flagged by: <strong>{featureLabels.join(", ")}</strong>
            </p>
          ) : null}

          {isAnomaly && featureLabels.length === 0 ? (
            <p className="anomaly-features">
              No single reading dominated the score.
            </p>
          ) : null}

          {anomaly.score !== null && anomaly.score !== undefined ? (
            <div className="anomaly-score">
              <span className="microlabel">Deviation score</span>
              <span className="anomaly-score-value num">
                {Number(anomaly.score).toFixed(3)}
              </span>
            </div>
          ) : null}

          <p className="anomaly-caveat">
            A raw deviation score from an unsupervised model — higher means
            further from the learned baseline. It is not an accuracy or a
            probability, and there is no labelled fault data to validate it
            against.
          </p>
        </div>
      )}
    </section>
  );
}
