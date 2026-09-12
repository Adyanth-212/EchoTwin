import json
import sys
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from serial_to_mqtt import build_publish_batch  # noqa: E402


class LiveBridgeMappingTests(unittest.TestCase):
    def test_builds_only_locked_topic_and_payloads(self):
        record = {
            "node_id": "node_1",
            "host_timestamp": "2026-09-12T12:00:00.000Z",
            "aht21_temperature_c": 25.25,
            "vibration_rms_mps2": 0.04,
            "mpu6050_acceleration_x_mps2": 1.0,
        }
        batch = build_publish_batch(record, "node_1")
        self.assertEqual(len(batch), 2)
        self.assertTrue(
            all(topic == "echotwin/sensors/node_1" for topic, _ in batch)
        )
        messages = [json.loads(payload) for _, payload in batch]
        self.assertEqual(
            {message["sensor"] for message in messages},
            {"temperature", "vibration_magnitude"},
        )
        for message in messages:
            self.assertEqual(
                set(message), {"node_id", "sensor", "value", "timestamp"}
            )


if __name__ == "__main__":
    unittest.main()
