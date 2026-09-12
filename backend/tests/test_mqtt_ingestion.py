import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from pydantic import ValidationError

from app import config
from app.mqtt_listener import on_message
from app.schemas.mqtt import MQTTMessage
from app.timestamp_validation import sensor_timestamp_rejection_reason


class FakeMqttMessage:
    topic = "echotwin/sensors/node_1"

    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")


def sensor_payload(timestamp):
    return {
        "node_id": "node_1",
        "sensor": "temperature",
        "value": 24.5,
        "timestamp": timestamp,
    }


class TimestampSchemaTests(unittest.TestCase):
    def test_timezone_is_required(self):
        with self.assertRaises(ValidationError):
            MQTTMessage.model_validate(
                sensor_payload("2026-09-12T15:00:00")
            )

    def test_firmware_utc_timestamp_is_accepted(self):
        message = MQTTMessage.model_validate(
            sensor_payload("2026-09-12T15:00:00Z")
        )
        self.assertEqual(message.timestamp.utcoffset(), timedelta(0))


class TimestampWindowTests(unittest.TestCase):
    def setUp(self):
        self.current_time = datetime(2026, 9, 12, 15, 0, tzinfo=timezone.utc)

    def test_current_timestamp_is_viable(self):
        reason = sensor_timestamp_rejection_reason(
            self.current_time, self.current_time
        )
        self.assertIsNone(reason)

    def test_stale_timestamp_is_rejected(self):
        with patch.object(config, "SENSOR_TIMESTAMP_MAX_AGE_SECONDS", 300):
            reason = sensor_timestamp_rejection_reason(
                self.current_time - timedelta(seconds=301),
                self.current_time,
            )
        self.assertIn("old", reason)

    def test_future_timestamp_is_rejected(self):
        with patch.object(
            config, "SENSOR_TIMESTAMP_FUTURE_TOLERANCE_SECONDS", 60
        ):
            reason = sensor_timestamp_rejection_reason(
                self.current_time + timedelta(seconds=61),
                self.current_time,
            )
        self.assertIn("future", reason)


class MqttIngestionTests(unittest.TestCase):
    @patch("app.mqtt_listener.build_room_status")
    @patch("app.mqtt_listener.db.insert_sensor_reading")
    def test_akshay_node_id_is_saved(self, insert_reading, build_status):
        timestamp = datetime.now(timezone.utc).isoformat()
        message = FakeMqttMessage(sensor_payload(timestamp))

        on_message(None, None, message)

        insert_reading.assert_called_once()
        self.assertEqual(insert_reading.call_args.args[1], "corridor_a")
        build_status.assert_called_once_with("corridor_a", "sensor")

    @patch("app.mqtt_listener.build_room_status")
    @patch("app.mqtt_listener.db.insert_sensor_reading")
    def test_stale_message_is_not_saved(self, insert_reading, build_status):
        timestamp = datetime.now(timezone.utc) - timedelta(minutes=10)
        message = FakeMqttMessage(sensor_payload(timestamp.isoformat()))

        on_message(None, None, message)

        insert_reading.assert_not_called()
        build_status.assert_not_called()


if __name__ == "__main__":
    unittest.main()
