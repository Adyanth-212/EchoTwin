# ml

Isolation Forest (scikit-learn) anomaly detection, trained on baseline
"normal" sensor readings pulled from TimescaleDB. Not implemented yet —
this is a placeholder so the backend's fusion logic (see the TODO in
`backend/app/mqtt_listener.py`) has somewhere to import from.

Per `EchoTwin_Master_Agent_Context.md` section 8: this model is
unsupervised with no labeled fault data. It produces an anomaly deviation
score, not a classification accuracy — never report or imply an accuracy
percentage for it.

## TODO

- [ ] Baseline data collection script (pull "normal" windows from Postgres)
- [ ] Train Isolation Forest, save to a local `.pt`/`.joblib` file (gitignored)
- [ ] Per-feature contribution scoring, to surface top 1-2 contributing
      features (feeds the `anomaly.top_features` field in
      `schemas/mqtt_and_ws.md`)
- [ ] Inference function the backend can call per new reading
