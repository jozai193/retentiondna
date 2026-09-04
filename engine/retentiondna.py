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


def build_plan(video: Path, points: list[Point], signals: list[Signal], transcript_path: Path | None) -> dict:
    transcript = []
    if transcript_path:
        transcript = json.loads(transcript_path.read_text(encoding="utf-8"))

    operations = []
    evidence = []
    strongest_dip = min((signal for signal in signals if signal.kind == "dip"), key=lambda signal: signal.delta, default=None)
    for signal in signals:
        nearby = [item for item in transcript if float(item.get("start", 0)) - 4 <= signal.time <= float(item.get("end", 0)) + 4]
        if signal == strongest_dip:
            start = max(0.0, signal.time - 18.0)
            end = max(start + 2.0, signal.time - 2.0)
            operations.append({"action": "remove", "start": round(start, 3), "end": round(end, 3), "reason": "strongest measured retention decline"})
        evidence.append({**asdict(signal), "transcript": nearby})

    return {
        "schema": "retentiondna.edit-plan.v1",
        "source": str(video),
        "evidence": evidence,
        "operations": non_overlapping_removals(operations),
        "disclaimer": "Evidence-informed edits do not guarantee future audience retention.",
    }


def render(video: Path, plan_path: Path, output: Path) -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required to render an edit plan")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    removes = [operation for operation in plan.get("operations", []) if operation.get("action") == "remove"]
    if not removes:
        shutil.copy2(video, output)
        return

    duration = probe_duration(video)
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
        plan = build_plan(args.video, points, signals, args.transcript)
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
