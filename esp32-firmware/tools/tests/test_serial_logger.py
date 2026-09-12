import json
import sys
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from serial_logger import (  # noqa: E402
    SERIAL_PREFIX,
    StructuredRecordError,
    flatten_record,
    parse_serial_line,
)


def valid_record():
    return {
        "schema_version": "1.0",
        "node_id": "node_1",
        "sample_id": 7,
        "device_uptime_ms": 7021,
        "status": {"aht21_ready": True, "mpu_window_samples": 100},
        "aht21_temperature_c": 25.125,
        "vibration_rms_mps2": 0.0432,
        "sw420_raw_state": 1,
    }


class SerialLoggerTests(unittest.TestCase):
    def test_parses_valid_structured_line(self):
        line = SERIAL_PREFIX + json.dumps(valid_record())
        parsed = parse_serial_line(line)
        self.assertEqual(parsed["node_id"], "node_1")
        self.assertEqual(parsed["sample_id"], 7)
        self.assertIsInstance(parsed["aht21_temperature_c"], float)

    def test_ignores_debug_line(self):
        self.assertIsNone(parse_serial_line("[AHT21] temperature=25.12 C"))

    def test_rejects_malformed_json(self):
        with self.assertRaises(StructuredRecordError):
            parse_serial_line(SERIAL_PREFIX + '{"sample_id":')

    def test_rejects_string_measurement(self):
        record = valid_record()
        record["aht21_temperature_c"] = "25.125"
        with self.assertRaises(StructuredRecordError):
            parse_serial_line(SERIAL_PREFIX + json.dumps(record))

    def test_flattens_nested_record_for_csv(self):
        flattened = flatten_record({"node_id": "node_1", "status": {"ready": True}})
        self.assertEqual(flattened["node_id"], "node_1")
        self.assertTrue(flattened["status.ready"])

    def test_representative_serial_text(self):
        fixture = Path(__file__).resolve().parent / "fixtures" / "representative_serial.txt"
        parsed = []
        malformed = 0
        for line in fixture.read_text(encoding="utf-8").splitlines():
            try:
                record = parse_serial_line(line)
                if record is not None:
                    parsed.append(record)
            except StructuredRecordError:
                malformed += 1
        self.assertEqual(len(parsed), 1)
        self.assertEqual(malformed, 1)


if __name__ == "__main__":
    unittest.main()
