import unittest
from pathlib import Path

from retentiondna import (
    Point,
    detect_signals,
    load_retention,
    non_overlapping_removals,
    parse_silence_log,
    transcript_features,
    validate_removals,
)


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

    def test_parses_ffmpeg_silence_evidence(self):
        log = "silence_start: 20.02\n silence_end: 27.11 | silence_duration: 7.09"
        silences = parse_silence_log(log)
        self.assertEqual((silences[0].start, silences[0].end), (20.02, 27.11))

    def test_transcript_features_are_explainable(self):
        features = transcript_features([
            {"start": 0, "end": 10, "text": "So basically this is really useful"},
            {"start": 10, "end": 20, "text": "This is really useful, so let us begin"},
        ])
        self.assertEqual(features[0]["wordsPerMinute"], 36)
        self.assertGreater(features[1]["repetitionScore"], 0)

    def test_rejects_overly_destructive_plan(self):
        with self.assertRaisesRegex(ValueError, "more than 35%"):
            validate_removals([{"action": "remove", "start": 0, "end": 40}], 100)

    def test_rejects_invalid_timestamp(self):
        with self.assertRaisesRegex(ValueError, "unsafe remove interval"):
            validate_removals([{"action": "remove", "start": -1, "end": 5}], 100)


if __name__ == "__main__":
    unittest.main()
