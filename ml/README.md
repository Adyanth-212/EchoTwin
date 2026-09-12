# ml

Isolation Forest (scikit-learn) anomaly detection. The checked-in model is
trained on deterministic synthetic normal-operation data so the complete
demo works before enough real baseline readings have been collected.
Retrain it with `python ml/train_anomaly.py` from the repository root.

Per `EchoTwin_Master_Agent_Context.md` section 8: this model is
unsupervised with no labeled fault data. It produces an anomaly deviation
score, not a classification accuracy — never report or imply an accuracy
percentage for it.

The backend reports the model's deviation score and estimates the two most
unusual features using their standardized distance from the training baseline.
Replace the synthetic baseline with verified normal TimescaleDB data before
using the model outside the hackathon demo.
