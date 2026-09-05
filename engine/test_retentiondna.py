import unittest
import tempfile
import json
import shutil
import subprocess
from pathlib import Path

from retentiondna import (
    Point,
    detect_signals,
    detect_silences,
    load_retention,
    non_overlapping_removals,
    parse_silence_log,
    probe_duration,
    probe_stream_types,
    render,
    source_identity,
    transcript_features,
    validate_removals,
)
from vretention_benchmark import benchmark, parse_duration, points_from_svg, svg_path_vertices
from youtube_analytics import points_from_report


class RetentionDnaTests(unittest.TestCase):
    def test_detects_sharp_dip(self):
        points = [Point(index * 5, value) for index, value in enumerate([100, 98, 96, 94, 91, 70, 55, 54, 53])]
        signals = detect_signals(points)
        self.assertTrue(any(signal.kind == "dip" and signal.delta <= -7 for signal in signals))

    def test_parses_youtube_normalized_ratios(self):
        csv_path = Path(__file__).parent / "fixtures" / "normalized-retention.csv"
        points = load_retention(csv_path, duration=120)
        self.assertEqual(points[1], Point(60, 72))

    def test_shared_golden_retention_contract(self):
        fixtures = json.loads(
            (Path(__file__).parent.parent / "fixtures" / "golden-retention-cases.json").read_text(encoding="utf-8")
        )
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            for index, fixture in enumerate(fixtures):
                csv_path = Path(directory) / f"case-{index}.csv"
                csv_path.write_text(fixture["csv"], encoding="utf-8")
                points = load_retention(csv_path, duration=fixture["duration"])
                self.assertEqual([point.time for point in points], fixture["times"], fixture["name"])
                self.assertEqual([point.retention for point in points], fixture["retention"], fixture["name"])

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

    def test_rejects_non_finite_retention_timestamp(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            csv_path = Path(directory) / "bad.csv"
            csv_path.write_text("time,retention\n0,100\nnan,80\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "timestamps must be finite"):
                load_retention(csv_path)

    def test_rejects_duplicate_retention_timestamps(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            csv_path = Path(directory) / "bad.csv"
            csv_path.write_text("time,retention\n0,100\n0,80\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "strictly increasing"):
                load_retention(csv_path)

    def test_rejects_invalid_transcript_segment(self):
        with self.assertRaisesRegex(ValueError, "unsafe time interval"):
            transcript_features([{"start": 5, "end": 2, "text": "out of order"}])

    def test_converts_official_youtube_analytics_report(self):
        report = {
            "columnHeaders": [
                {"name": "elapsedVideoTimeRatio", "columnType": "DIMENSION", "dataType": "FLOAT"},
                {"name": "audienceWatchRatio", "columnType": "METRIC", "dataType": "FLOAT"},
            ],
            "rows": [[0, 1.0], [0.5, 0.72], [1, 0.41]],
        }
        self.assertEqual(points_from_report(report, 120), [Point(0, 100), Point(60, 72), Point(120, 41)])

    def test_youtube_report_allows_rewatched_segments_over_one(self):
        report = {
            "columnHeaders": [{"name": "elapsedVideoTimeRatio"}, {"name": "audienceWatchRatio"}],
            "rows": [[0, 1], [1, 1.2]],
        }
        self.assertEqual(points_from_report(report, 10)[1].retention, 120)

    def test_youtube_report_rejects_missing_columns(self):
        with self.assertRaisesRegex(ValueError, "missing required columns"):
            points_from_report({"columnHeaders": [{"name": "views"}], "rows": [[1], [2]]}, 10)

    def test_flattens_svg_heat_map_and_normalizes_timeline(self):
        points = points_from_svg("M0 80 C25 80 25 20 50 20 S75 80 100 80", 200, samples=5)
        self.assertEqual([point.time for point in points], [0, 50, 100, 150, 200])
        self.assertGreater(points[2].retention, points[0].retention)

    def test_svg_parser_supports_relative_commands(self):
        vertices = svg_path_vertices("m 0 100 l 50 -50 50 50")
        self.assertEqual(vertices[-1], (100, 100))

    def test_parses_vretention_durations(self):
        self.assertEqual(parse_duration("PT1M30S"), 90)
        self.assertEqual(parse_duration("45"), 45)

    def test_vretention_benchmark_fails_closed_on_bad_samples(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            dataset = Path(directory) / "youtube.csv"
            dataset.write_text(
                "id,duration,retentionCurve,countryCode,categoryId\n"
                'ok,10,"M0 80 L100 20",US,1\n'
                'bad,10,"not-a-path",IN,2\n',
                encoding="utf-8",
            )
            result = benchmark(dataset, limit=10, max_error_rate=0.1)
            self.assertEqual(result["status"], "failed")
            self.assertEqual(result["parsed"], 1)
            self.assertEqual(result["errors"], 1)
            self.assertEqual(result["errorExamples"][0]["id"], "bad")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg tools are required")
class RetentionDnaIntegrationTests(unittest.TestCase):
    def test_renders_video_without_audio(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            source = root / "silent-source.mp4"
            output = root / "silent-cut.mp4"
            plan = root / "plan.json"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=6",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
                ],
                check=True,
            )
            plan.write_text(
                json.dumps(
                    {
                        "schema": "retentiondna.edit-plan.v2",
                        "source": source_identity(source),
                        "operations": [{"action": "remove", "start": 2, "end": 3}],
                        "disclaimer": "test plan",
                    }
                ),
                encoding="utf-8",
            )

            render(source, plan, output)

            self.assertEqual(probe_stream_types(output), {"video"})
            self.assertAlmostEqual(probe_duration(output), 5.0, delta=0.15)

    def test_renders_promoted_teaser_and_verifies_source_identity(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            source = root / "source.mp4"
            promoted = root / "promoted.mp4"
            plan = root / "promote.json"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=6",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
                ],
                check=True,
            )
            payload = {
                "schema": "retentiondna.edit-plan.v2",
                "source": source_identity(source),
                "operations": [{"action": "promote", "start": 2, "end": 3, "reason": "replay spike"}],
                "disclaimer": "test plan",
            }
            plan.write_text(json.dumps(payload), encoding="utf-8")
            render(source, plan, promoted)
            self.assertAlmostEqual(probe_duration(promoted), 7.0, delta=0.15)

            payload["source"]["sha256"] = "0" * 64
            plan.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source identity does not match"):
                render(source, plan, root / "wrong-source.mp4")

    def test_rejects_unsupported_edit_action(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            root = Path(directory)
            source = root / "source.mp4"
            plan = root / "unknown.json"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=12:duration=2",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
                ],
                check=True,
            )
            plan.write_text(
                json.dumps(
                    {
                        "schema": "retentiondna.edit-plan.v2",
                        "source": source_identity(source),
                        "operations": [{"action": "teleport", "start": 0, "end": 1, "reason": "invalid"}],
                        "disclaimer": "test plan",
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "unsupported edit-plan actions"):
                render(source, plan, root / "output.mp4")

    def test_detects_real_silence_in_audio_video(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as directory:
            source = Path(directory) / "audio-evidence.mp4"
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", "color=c=navy:size=320x180:rate=24:duration=3.5",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
                    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000:duration=1.5",
                    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=1",
                    "-filter_complex", "[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(source),
                ],
                check=True,
            )

            silences = detect_silences(source, minimum_duration=0.8)

            self.assertTrue(any(item.duration >= 1.3 for item in silences))


if __name__ == "__main__":
    unittest.main()
