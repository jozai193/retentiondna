"""RetentionDNA local analysis and deterministic FFmpeg renderer.

No cloud service is required. The analyzer aligns timestamped audience-retention
data with a transcript and emits an auditable edit plan. The renderer applies
validated remove and payoff-promotion operations without executing generated
shell commands.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
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
    time_key = next((aliases[name] for name in ("time", "timestamp", "elapsedvideotimeratio", "elapsed ratio", "position_ratio", "position_percentage", "position_seconds", "elapsed") if name in aliases), None)
    retention_key = next((aliases[name] for name in ("retention", "audiencewatchratio", "audience_ratio", "audience_percentage", "audience retention", "watch ratio") if name in aliases), None)
    if not time_key or not retention_key:
        raise ValueError("expected time/timestamp, YouTube Analytics, or ACAU position and audience columns")

    normalized_time = time_key.strip().lower() in {"elapsedvideotimeratio", "elapsed ratio", "position_ratio", "position_percentage"}
    percentage_time = time_key.strip().lower() == "position_percentage"
    ratio_retention = retention_key.strip().lower() in {"audiencewatchratio", "watch ratio", "audience_ratio"}
    parsed = [
        Point(
            parse_time(row[time_key], normalized=normalized_time, percentage_header=percentage_time),
            parse_retention_value(row[retention_key], ratio_header=ratio_retention),
        )
        for row in rows
    ]
    if any(point.time < 0 for point in parsed):
        raise ValueError("retention timestamps cannot be negative")
    if any(point.retention < 0 for point in parsed):
        raise ValueError("retention values cannot be negative")
    if normalized_time and duration is None:
        raise ValueError("elapsedVideoTimeRatio input requires a video duration")

    points = sorted(
        [
            Point(
                round(point.time * duration, 6) if normalized_time and duration else point.time,
                point.retention,
            )
            for point in parsed
        ],
        key=lambda point: point.time,
    )
    if any(current.time <= previous.time for previous, current in zip(points, points[1:])):
        raise ValueError("retention timestamps must be strictly increasing")
    if duration is not None and points[-1].time > duration + 0.1:
        raise ValueError("retention timestamps exceed the source video duration")
    return points


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
    if "audio" not in probe_stream_types(video):
        return []
    completed = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-vn",
            "-af", f"silencedetect=noise={noise}:d={minimum_duration}", "-f", "null", os.devnull,
        ],
        capture_output=True,
        text=True,
        check=True,
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
        check=True,
    )
    return sorted({round(float(value), 3) for value in re.findall(r"pts_time:([0-9.]+)", completed.stderr)})


def transcript_features(items: list[dict]) -> list[dict]:
    """Calculate auditable pace/filler/repetition features from timestamped text."""
    filler_words = {"actually", "basically", "just", "like", "really", "so", "well"}
    result: list[dict] = []
    previous_tokens: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"transcript segment {index + 1} must be an object")
        try:
            start, end = float(item.get("start", 0)), float(item.get("end", 0))
        except (TypeError, ValueError) as error:
            raise ValueError(f"transcript segment {index + 1} needs numeric start and end timestamps") from error
        text = str(item.get("text", "")).strip()
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
            raise ValueError(f"transcript segment {index + 1} has an unsafe time interval")
        if not text:
            raise ValueError(f"transcript segment {index + 1} needs non-empty text")
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
    video_duration = probe_duration(video)
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
    strongest_spike = max((signal for signal in signals if signal.kind == "spike"), key=lambda signal: signal.delta, default=None)
    primary_signal = strongest_dip or strongest_spike
    for signal in signals:
        nearby = [item for item in features if item["start"] - 6 <= signal.time <= item["end"] + 6]
        nearby_silences = [asdict(item) for item in silences if item.end >= signal.time - 20 and item.start <= signal.time + 5]
        nearby_scenes = [timestamp for timestamp in scene_changes if signal.time - 20 <= timestamp <= signal.time + 5]
        confidence = min(0.98, 0.58 + min(abs(signal.delta), 20) / 100 + (0.12 if nearby else 0) + (0.12 if nearby_silences else 0))
        if signal == primary_signal:
            if signal.kind == "dip":
                start, end, reason = recommend_removal(signal, nearby, silences, video_duration)
                action = "remove"
            else:
                maximum_teaser = min(8.0, max(1.0, video_duration * 0.15))
                start, end = signal.time, min(video_duration, signal.time + maximum_teaser)
                reason = "prepend a short teaser from the strongest measured replay spike"
                action = "promote"
            operations.append(
                {
                    "action": action,
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
        "schema": "retentiondna.edit-plan.v2",
        "source": source_identity(video, video_duration),
        "analysis": {
            "retentionPoints": len(points),
            "silencesDetected": len(silences),
            "sceneChangesDetected": len(scene_changes),
            "transcriptSegments": len(features),
        },
        "evidence": evidence,
        "operations": operations,
        "disclaimer": "Evidence-informed edits do not guarantee future audience retention.",
    }


def recommend_removal(
    signal: Signal,
    nearby_transcript: list[dict],
    silences: list[Silence],
    duration: float,
) -> tuple[float, float, str]:
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
        start, end = bounded_interval(start, max(start + 2.0, end), duration)
        return start, end, "tighten repeated setup containing measured silence before the retention drop"
    if nearby_silence:
        start = max(window_start, nearby_silence.start - 1.0)
        end = min(signal.time + 1.0, nearby_silence.end + 1.0)
        start, end = bounded_interval(start, max(start + 2.0, end), duration)
        return start, end, "remove measured silence immediately before the retention drop"
    if transcript_candidate:
        end = min(signal.time + 1.0, transcript_candidate["end"])
        start = max(window_start, end - 18.0)
        start, end = bounded_interval(start, max(start + 2.0, end), duration)
        return start, end, "tighten the transcript segment aligned to the strongest retention decline"
    start = max(0.0, signal.time - 18.0)
    start, end = bounded_interval(start, max(start + 2.0, signal.time - 2.0), duration)
    return start, end, "tighten the window before the strongest measured retention decline"


def bounded_interval(start: float, end: float, duration: float) -> tuple[float, float]:
    end = min(duration, end)
    start = max(0.0, min(start, end - min(0.5, duration)))
    if end <= start:
        raise ValueError("could not create a safe repair interval inside the source duration")
    return start, end


def render(video: Path, plan_path: Path, output: Path) -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to render an edit plan")
    if not video.is_file():
        raise ValueError(f"source video does not exist: {video}")
    if video.resolve() == output.resolve():
        raise ValueError("output path must be different from the source video")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if not isinstance(plan, dict):
        raise ValueError("edit plan must be a JSON object")
    if plan.get("schema") != "retentiondna.edit-plan.v2":
        raise ValueError("unsupported or missing edit-plan schema")
    duration = probe_duration(video)
    validate_source_identity(plan.get("source"), video, duration)
    operations = plan.get("operations", [])
    if not isinstance(operations, list) or any(not isinstance(operation, dict) for operation in operations):
        raise ValueError("edit-plan operations must be an array of objects")
    if not operations:
        raise ValueError("edit plan needs at least one operation")
    unsupported = sorted({str(operation.get("action")) for operation in operations if operation.get("action") not in {"remove", "promote"}})
    if unsupported:
        raise ValueError(f"unsupported edit-plan actions: {', '.join(unsupported)}")
    removes = [operation for operation in operations if operation.get("action") == "remove"]
    removes = validate_removals(removes, duration)
    promotes = validate_promotions(
        [operation for operation in operations if operation.get("action") == "promote"],
        duration,
    )
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

    has_audio = "audio" in probe_stream_types(video)
    filters = []
    concat_inputs = []
    segments = [(float(item["start"]), float(item["end"])) for item in promotes] + keeps
    for index, (start, end) in enumerate(segments):
        filters.append(f"[0:v]trim=start={start}:end={end},setpts=PTS-STARTPTS[v{index}]")
        if has_audio:
            filters.append(f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{index}]")
            concat_inputs.append(f"[v{index}][a{index}]")
        else:
            concat_inputs.append(f"[v{index}]")
    filters.append(
        "".join(concat_inputs)
        + (f"concat=n={len(segments)}:v=1:a=1[outv][outa]" if has_audio else f"concat=n={len(segments)}:v=1:a=0[outv]")
    )

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(video),
        "-filter_complex", ";".join(filters), "-map", "[outv]",
    ]
    if has_audio:
        command.extend(["-map", "[outa]"])
    command.extend(["-c:v", "libx264", "-preset", "medium", "-crf", "20"])
    if has_audio:
        command.extend(["-c:a", "aac"])
    command.extend(["-movflags", "+faststart", str(output)])
    subprocess.run(command, check=True)


def validate_removals(removes: list[dict], duration: float) -> list[dict]:
    parsed: list[dict] = []
    for operation in removes:
        try:
            start, end = float(operation["start"]), float(operation["end"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("remove operations need numeric start and end timestamps") from error
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or end > duration:
            raise ValueError(f"unsafe remove interval {start:g}-{end:g} for {duration:g}s source")
        parsed.append({**operation, "start": start, "end": end})
    validated = non_overlapping_removals(parsed)
    removed_duration = sum(float(item["end"]) - float(item["start"]) for item in validated)
    if removed_duration > duration * 0.35:
        raise ValueError("edit plan removes more than 35% of the source; manual review required")
    return validated


def validate_promotions(promotes: list[dict], duration: float) -> list[dict]:
    if len(promotes) > 1:
        raise ValueError("edit plan may promote at most one teaser")
    parsed: list[dict] = []
    maximum_duration = min(12.0, max(2.0, duration * 0.2))
    for operation in promotes:
        try:
            start, end = float(operation["start"]), float(operation["end"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError("promote operations need numeric start and end timestamps") from error
        teaser_duration = end - start
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or end > duration:
            raise ValueError(f"unsafe promote interval {start:g}-{end:g} for {duration:g}s source")
        if teaser_duration > maximum_duration:
            raise ValueError(f"promoted teaser exceeds the {maximum_duration:g}s safety limit")
        parsed.append({**operation, "start": start, "end": end})
    return parsed


def source_identity(video: Path, duration: float | None = None) -> dict:
    resolved_duration = probe_duration(video) if duration is None else duration
    digest = hashlib.sha256()
    with video.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "name": video.name,
        "sizeBytes": video.stat().st_size,
        "durationSeconds": round(resolved_duration, 3),
        "sha256": digest.hexdigest(),
    }


def validate_source_identity(identity: object, video: Path, duration: float) -> None:
    if not isinstance(identity, dict):
        raise ValueError("edit plan needs a source identity object")
    expected = source_identity(video, duration)
    try:
        size = int(identity["sizeBytes"])
        plan_duration = float(identity["durationSeconds"])
        digest = str(identity["sha256"]).lower()
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("source identity needs sizeBytes, durationSeconds, and sha256") from error
    if size != expected["sizeBytes"] or abs(plan_duration - duration) > 0.15 or digest != expected["sha256"]:
        raise ValueError("edit plan source identity does not match the selected video")


def probe_duration(video: Path) -> float:
    if not shutil.which("ffprobe"):
        raise RuntimeError("ffprobe is required to inspect the source video")
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(video)],
        check=True, capture_output=True, text=True,
    )
    return float(completed.stdout.strip())


def probe_stream_types(video: Path) -> set[str]:
    """Return the source stream types without assuming that audio exists."""
    if not shutil.which("ffprobe"):
        raise RuntimeError("ffprobe is required to inspect the source video")
    completed = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(video)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)
    stream_types = {stream.get("codec_type") for stream in payload.get("streams", [])}
    if "video" not in stream_types:
        raise ValueError("source file does not contain a video stream")
    return {stream_type for stream_type in stream_types if isinstance(stream_type, str)}


def non_overlapping_removals(operations: Iterable[dict]) -> list[dict]:
    result: list[dict] = []
    for operation in sorted(operations, key=lambda item: float(item["start"])):
        if result and float(operation["start"]) <= float(result[-1]["end"]):
            result[-1]["end"] = max(float(result[-1]["end"]), float(operation["end"]))
        else:
            result.append(dict(operation))
    return result


def parse_time(value: str, normalized: bool = False, percentage_header: bool = False) -> float:
    cleaned = value.strip()
    if ":" in cleaned:
        total = 0.0
        for part in cleaned.split(":"):
            total = total * 60 + float(part)
        number = total
    else:
        number = float(cleaned.rstrip("%"))
        if normalized and (cleaned.endswith("%") or percentage_header):
            number /= 100
    if not math.isfinite(number):
        raise ValueError("retention timestamps must be finite")
    return number


def parse_number(value: str) -> float:
    number = float(value.strip().rstrip("%"))
    if not math.isfinite(number):
        raise ValueError("retention values must be finite")
    return number


def parse_retention_value(value: str, ratio_header: bool = False) -> float:
    cleaned = value.strip()
    number = parse_number(cleaned)
    if cleaned.endswith("%"):
        return number
    if ratio_header:
        return number * 100
    return number * 100 if number <= 1.5 else number


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze retention signals and render evidence-informed video edits")
    subparsers = parser.add_subparsers(dest="command", required=True)
    analyze = subparsers.add_parser("analyze", help="create an auditable edit plan")
    analyze.add_argument("--video", type=Path, required=True)
    analyze.add_argument("--retention", type=Path, required=True)
    analyze.add_argument("--transcript", type=Path)
    analyze.add_argument("--out", type=Path, required=True)
    render_parser = subparsers.add_parser("render", help="apply validated remove and promote operations with ffmpeg")
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
