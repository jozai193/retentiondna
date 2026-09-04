"""RetentionDNA local analysis and deterministic FFmpeg renderer.

No cloud service is required. The analyzer aligns timestamped audience-retention
data with a transcript and emits an auditable edit plan. The renderer applies
safe remove operations without asking an LLM to construct shell commands.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import mean
from typing import Iterable


@dataclass(frozen=True)
class Point:
    time: float
    retention: float


@dataclass(frozen=True)
class Signal:
    kind: str
    time: float
    delta: float
    retention: float
    severity: str


@dataclass(frozen=True)
class Silence:
    start: float
    end: float
    duration: float


def load_retention(path: Path, duration: float | None = None) -> list[Point]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) < 2:
        raise ValueError("retention CSV needs at least two data rows")

    aliases = {key.strip().lower(): key for key in (rows[0].keys() or [])}
    time_key = next((aliases[name] for name in ("time", "timestamp", "elapsedvideotimeratio", "elapsed ratio", "elapsed") if name in aliases), None)
    retention_key = next((aliases[name] for name in ("retention", "audiencewatchratio", "audience retention", "watch ratio") if name in aliases), None)
    if not time_key or not retention_key:
        raise ValueError("expected time/timestamp and retention/audienceWatchRatio columns")

    parsed = [Point(parse_time(row[time_key]), parse_number(row[retention_key])) for row in rows]
    normalized_time = parsed[-1].time <= 1 and any(0 < point.time < 1 for point in parsed)
    if normalized_time and duration is None:
        raise ValueError("elapsedVideoTimeRatio input requires a video duration")

    return sorted(
        [
            Point(
                point.time * duration if normalized_time and duration else point.time,
                point.retention * 100 if point.retention <= 1.5 else point.retention,
            )
            for point in parsed
        ],
        key=lambda point: point.time,
    )


def detect_signals(points: list[Point]) -> list[Signal]:
    candidates: list[Signal] = []
    for index in range(2, len(points) - 1):
        before = mean(point.retention for point in points[max(0, index - 2):index])
        after = mean(point.retention for point in points[index:min(len(points), index + 2)])
        delta = round(after - before, 1)
        if delta <= -7 or delta >= 7:
            candidates.append(
                Signal(
                    kind="dip" if delta < 0 else "spike",
                    time=points[index].time,
                    delta=delta,
                    retention=points[index].retention,
                    severity="high" if abs(delta) >= 13 else "medium",
                )
            )

    strongest = sorted(candidates, key=lambda signal: abs(signal.delta), reverse=True)
    deduped: list[Signal] = []
    for signal in strongest:
        if all(abs(existing.time - signal.time) >= 10 for existing in deduped):
            deduped.append(signal)
    return sorted(deduped[:6], key=lambda signal: signal.time)


def detect_silences(video: Path, noise: str = "-38dB", minimum_duration: float = 0.8) -> list[Silence]:
    """Return real silent intervals reported by FFmpeg's silencedetect filter."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to inspect audio evidence")
    completed = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-vn",
            "-af", f"silencedetect=noise={noise}:d={minimum_duration}", "-f", "null", os.devnull,
        ],
        capture_output=True,
        text=True,
    )
    return parse_silence_log(completed.stderr)


def parse_silence_log(log: str) -> list[Silence]:
    starts = [float(value) for value in re.findall(r"silence_start:\s*([0-9.]+)", log)]
    ends = [
        (float(end), float(duration))
        for end, duration in re.findall(r"silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)", log)
    ]
    return [
        Silence(round(start, 3), round(end, 3), round(duration, 3))
        for start, (end, duration) in zip(starts, ends)
        if end > start
    ]


def detect_scene_changes(video: Path, threshold: float = 0.03) -> list[float]:
    """Return frame timestamps where FFmpeg measures a meaningful scene change."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to inspect scene evidence")
    completed = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-an",
            "-vf", f"select='gt(scene,{threshold})',showinfo", "-vsync", "vfr", "-f", "null", os.devnull,
        ],
        capture_output=True,
        text=True,
    )
    return sorted({round(float(value), 3) for value in re.findall(r"pts_time:([0-9.]+)", completed.stderr)})


def transcript_features(items: list[dict]) -> list[dict]:
    """Calculate auditable pace/filler/repetition features from timestamped text."""
    filler_words = {"actually", "basically", "just", "like", "really", "so", "well"}
    result: list[dict] = []
    previous_tokens: set[str] = set()
    for item in items:
        start, end = float(item.get("start", 0)), float(item.get("end", 0))
        text = str(item.get("text", "")).strip()
        tokens = re.findall(r"[a-z']+", text.lower())
        token_set = set(tokens)
        union = token_set | previous_tokens
        similarity = len(token_set & previous_tokens) / len(union) if union else 0.0
        duration = max(0.1, end - start)
        result.append(
            {
                "start": start,
                "end": end,
                "text": text,
                "wordsPerMinute": round(len(tokens) * 60 / duration),
                "fillerCount": sum(token in filler_words for token in tokens),
                "repetitionScore": round(similarity, 2),
            }
        )
        previous_tokens = token_set
    return result


def build_plan(
    video: Path,
    points: list[Point],
    signals: list[Signal],
    transcript_path: Path | None,
    silences: list[Silence] | None = None,
    scene_changes: list[float] | None = None,
) -> dict:
    transcript = []
    if transcript_path:
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
        if not isinstance(transcript, list):
            raise ValueError("transcript JSON must be an array")
    features = transcript_features(transcript)
    silences = silences or []
    scene_changes = scene_changes or []

    operations = []
    evidence = []
    strongest_dip = min((signal for signal in signals if signal.kind == "dip"), key=lambda signal: signal.delta, default=None)
    for signal in signals:
        nearby = [item for item in features if item["start"] - 6 <= signal.time <= item["end"] + 6]
        nearby_silences = [asdict(item) for item in silences if item.end >= signal.time - 20 and item.start <= signal.time + 5]
        nearby_scenes = [timestamp for timestamp in scene_changes if signal.time - 20 <= timestamp <= signal.time + 5]
        confidence = min(0.98, 0.58 + min(abs(signal.delta), 20) / 100 + (0.12 if nearby else 0) + (0.12 if nearby_silences else 0))
        if signal == strongest_dip:
            start, end, reason = recommend_removal(signal, nearby, silences)
            operations.append(
                {
                    "action": "remove",
                    "start": round(start, 3),
                    "end": round(end, 3),
                    "reason": reason,
                    "evidenceRefs": [f"retention@{signal.time:g}"]
                    + (["audio:silence"] if nearby_silences else [])
                    + (["transcript:pace-repetition"] if nearby else []),
                }
            )
        evidence.append(
            {
                **asdict(signal),
                "confidence": round(confidence, 2),
                "transcript": nearby,
                "audio": {"silences": nearby_silences},
                "visual": {"sceneChanges": nearby_scenes, "sceneChangeCount": len(nearby_scenes)},
            }
        )

    return {
        "schema": "retentiondna.edit-plan.v1",
        "source": str(video),
        "analysis": {
            "retentionPoints": len(points),
            "silencesDetected": len(silences),
            "sceneChangesDetected": len(scene_changes),
            "transcriptSegments": len(features),
        },
        "evidence": evidence,
        "operations": non_overlapping_removals(operations),
        "disclaimer": "Evidence-informed edits do not guarantee future audience retention.",
    }


def recommend_removal(signal: Signal, nearby_transcript: list[dict], silences: list[Silence]) -> tuple[float, float, str]:
    window_start, window_end = max(0.0, signal.time - 20.0), signal.time + 3.0
    nearby_silence = max(
        (item for item in silences if item.end >= window_start and item.start <= window_end),
        key=lambda item: item.duration,
        default=None,
    )
    transcript_candidate = next(
        (item for item in nearby_transcript if item["start"] < signal.time and item["end"] - item["start"] <= 24),
        None,
    )
    if nearby_silence and transcript_candidate:
        end = min(signal.time + 5.0, max(nearby_silence.end + 1.0, transcript_candidate["end"]))
        start = max(window_start, end - 18.0, min(transcript_candidate["start"], nearby_silence.start - 1.0))
        return start, max(start + 2.0, end), "tighten repeated setup containing measured silence before the retention drop"
    if nearby_silence:
        start = max(window_start, nearby_silence.start - 1.0)
        end = min(signal.time + 1.0, nearby_silence.end + 1.0)
        return start, max(start + 2.0, end), "remove measured silence immediately before the retention drop"
    if transcript_candidate:
        end = min(signal.time + 1.0, transcript_candidate["end"])
        start = max(window_start, end - 18.0)
        return start, max(start + 2.0, end), "tighten the transcript segment aligned to the strongest retention decline"
    start = max(0.0, signal.time - 18.0)
    return start, max(start + 2.0, signal.time - 2.0), "tighten the window before the strongest measured retention decline"


def render(video: Path, plan_path: Path, output: Path) -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to render an edit plan")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    removes = [operation for operation in plan.get("operations", []) if operation.get("action") == "remove"]
    if not removes:
        shutil.copy2(video, output)
        return

    duration = probe_duration(video)
    removes = validate_removals(removes, duration)
    keeps: list[tuple[float, float]] = []
    cursor = 0.0
    for operation in sorted(removes, key=lambda item: float(item["start"])):
        start, end = float(operation["start"]), float(operation["end"])
        if start > cursor:
            keeps.append((cursor, min(start, duration)))
        cursor = max(cursor, end)
    if cursor < duration:
        keeps.append((cursor, duration))
    if not keeps:
        raise ValueError("edit plan removes the entire source video")

    filters = []
    concat_inputs = []
    for index, (start, end) in enumerate(keeps):
        filters.append(f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{index}]")
        filters.append(f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{index}]")
        concat_inputs.append(f"[v{index}][a{index}]")
    filters.append("".join(concat_inputs) + f"concat=n={len(keeps)}:v=1:a=1[outv][outa]")

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
        "-filter_complex", ";".join(filters), "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", str(output),
    ]
    subprocess.run(command, check=True)


def validate_removals(removes: list[dict], duration: float) -> list[dict]:
    validated: list[dict] = []
    for operation in non_overlapping_removals(removes):
        try:
            start, end = float(operation["start"]), float(operation["end"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("remove operations need numeric start and end timestamps") from error
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or end > duration:
            raise ValueError(f"unsafe remove interval {start:g}-{end:g} for {duration:g}s source")
        validated.append(operation)
    removed_duration = sum(float(item["end"]) - float(item["start"]) for item in validated)
    if removed_duration > duration * 0.35:
        raise ValueError("edit plan removes more than 35% of the source; manual review required")
    return validated


def probe_duration(video: Path) -> float:
    if not shutil.which("ffprobe"):
        raise RuntimeError("ffprobe is required to inspect the source video")
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video)],
        check=True, capture_output=True, text=True,
    )
    return float(completed.stdout.strip())


def non_overlapping_removals(operations: Iterable[dict]) -> list[dict]:
    result: list[dict] = []
    for operation in sorted(operations, key=lambda item: float(item["start"])):
        if result and float(operation["start"]) <= float(result[-1]["end"]):
            result[-1]["end"] = max(float(result[-1]["end"]), float(operation["end"]))
        else:
            result.append(dict(operation))
    return result


def parse_time(value: str) -> float:
    cleaned = value.strip()
    if ":" in cleaned:
        total = 0.0
        for part in cleaned.split(":"):
            total = total * 60 + float(part)
        return total
    return float(cleaned.rstrip("%"))


def parse_number(value: str) -> float:
    number = float(value.strip().rstrip("%"))
    if not math.isfinite(number):
        raise ValueError("retention values must be finite")
    return number


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze retention signals and render evidence-informed video edits")
    subparsers = parser.add_subparsers(dest="command", required=True)
    analyze = subparsers.add_parser("analyze", help="create an auditable edit plan")
    analyze.add_argument("--video", type=Path, required=True)
    analyze.add_argument("--retention", type=Path, required=True)
    analyze.add_argument("--transcript", type=Path)
    analyze.add_argument("--out", type=Path, required=True)
    render_parser = subparsers.add_parser("render", help="apply safe remove operations with ffmpeg")
    render_parser.add_argument("--video", type=Path, required=True)
    render_parser.add_argument("--plan", type=Path, required=True)
    render_parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    if args.command == "analyze":
        duration = probe_duration(args.video)
        points = load_retention(args.retention, duration)
        signals = detect_signals(points)
        silences = detect_silences(args.video)
        scene_changes = detect_scene_changes(args.video)
        plan = build_plan(args.video, points, signals, args.transcript, silences, scene_changes)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(plan, indent=2), encoding="utf-8")
        print(json.dumps({"signals": len(signals), "operations": len(plan["operations"]), "plan": str(args.out)}))
    else:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        render(args.video, args.plan, args.out)
        print(json.dumps({"rendered": str(args.out), "duration": probe_duration(args.out)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
