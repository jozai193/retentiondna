import unittest
from pathlib import Path

from retentiondna import Point, detect_signals, load_retention, non_overlapping_removals


class RetentionDnaTests(unittest.TestCase):
    def test_detects_sharp_dip(self):
        points = [Point(index * 5, value) for index, value in enumerate([100, 98, 96, 94, 91, 70, 55, 54, 53])]
        signals = detect_signals(points)
        self.assertTrue(any(signal.kind == "dip" and signal.delta <= -7 for signal in signals))

    def test_parses_youtube_normalized_ratios(self):
        csv_path = Path(__file__).parent / "fixtures" / "normalized-retention.csv"
        points = load_retention(csv_path, duration=120)
        self.assertEqual(points[1], Point(60, 72))

    def test_merges_overlapping_repairs(self):
        operations = [
            {"action": "remove", "start": 10, "end": 20, "reason": "a"},
            {"action": "remove", "start": 18, "end": 24, "reason": "b"},
        ]
        merged = non_overlapping_removals(operations)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["end"], 24)


if __name__ == "__main__":
    unittest.main()
