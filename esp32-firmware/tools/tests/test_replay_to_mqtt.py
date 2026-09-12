import sys
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from replay_to_mqtt import ALLOWED_MQTT_SENSORS, map_record_to_messages  # noqa: E402


class ReplayMappingTests(unittest.TestCase):
    def test_maps_only_locked_mqtt_fields(self):
        record = {
            "node_id": "node_1",
            "host_timestamp": "2026-09-12T08:30:00.000Z",
            "aht21_temperature_c": 25.1,
            "aht21_relative_humidity_pct": 51.2,
            "ens160_eco2_ppm": 450,
            "ens160_tvoc_ppb": 20,
            "ens160_aqi": 1,
            "mlx90614_ambient_temperature_c": 24.9,
            "mlx90614_object_temperature_c": 29.4,
            "mpu6050_acceleration_x_mps2": 0.1,
            "vibration_rms_mps2": 0.04,
            "sw420_trip_state": 0,
        }
        messages = map_record_to_messages(record)
        sensors = {message["sensor"] for message in messages}
        self.assertEqual(sensors, ALLOWED_MQTT_SENSORS)
        self.assertNotIn("mpu6050_acceleration_x_mps2", sensors)
        self.assertNotIn("mlx90614_ambient_temperature_c", sensors)
        for message in messages:
            self.assertEqual(
                set(message), {"node_id", "sensor", "value", "timestamp"}
            )
            self.assertEqual(message["timestamp"], record["host_timestamp"])

    def test_null_values_are_not_published(self):
        record = {
            "node_id": "node_1",
            "host_timestamp": "2026-09-12T08:30:00Z",
            "aht21_temperature_c": None,
            "sw420_trip_state": 1,
        }
        messages = map_record_to_messages(record, "review_node")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["node_id"], "review_node")
        self.assertEqual(messages[0]["sensor"], "vibration_trip")


if __name__ == "__main__":
    unittest.main()
