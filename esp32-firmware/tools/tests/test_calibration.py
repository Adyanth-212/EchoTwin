import math
import sys
import unittest
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parents[1]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from analyze_calibration import calculate_statistics, detect_sw420_stuck  # noqa: E402


class CalibrationTests(unittest.TestCase):
    def test_calibration_statistics(self):
        result = calculate_statistics([1, 2, 3, 4])
        self.assertEqual(result["sample_count"], 4)
        self.assertEqual(result["mean"], 2.5)
        self.assertEqual(result["median"], 2.5)
        self.assertAlmostEqual(result["standard_deviation"], math.sqrt(1.25))
        self.assertAlmostEqual(result["percentile_5"], 1.15)
        self.assertAlmostEqual(result["percentile_25"], 1.75)
        self.assertAlmostEqual(result["percentile_75"], 3.25)
        self.assertAlmostEqual(result["percentile_95"], 3.85)

    def test_sw420_stuck_high(self):
        self.assertTrue(detect_sw420_stuck(1000, 0, 0))

    def test_sw420_stuck_low(self):
        self.assertTrue(detect_sw420_stuck(0, 1000, 0))

    def test_sw420_not_stuck_when_both_states_observed(self):
        self.assertFalse(detect_sw420_stuck(900, 100, 2))

    def test_sw420_unknown_without_samples(self):
        self.assertIsNone(detect_sw420_stuck(0, 0, 0))


if __name__ == "__main__":
    unittest.main()
