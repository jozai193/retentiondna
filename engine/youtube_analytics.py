"""Convert an official YouTube Analytics retention report into RetentionDNA points.

Authentication and HTTP transport intentionally live outside this module.  The
converter accepts the JSON body returned by ``reports.query`` so OAuth tokens
never need to be written to the project or passed to the analysis engine.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any

from retentiondna import Point


REQUIRED_COLUMNS = ("elapsedVideoTimeRatio", "audienceWatchRatio")


def points_from_report(payload: dict[str, Any], duration: float) -> list[Point]:
    """Validate a YouTube Analytics API response and return timeline points."""
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("video duration must be a positive finite number")
    if not isinstance(payload, dict):
        raise ValueError("YouTube Analytics report must be a JSON object")

    headers = payload.get("columnHeaders")
    rows = payload.get("rows")
    if not isinstance(headers, list) or not all(isinstance(item, dict) for item in headers):
        raise ValueError("report needs a columnHeaders array")
    if not isinstance(rows, list) or len(rows) < 2:
        raise ValueError("report needs at least two retention rows")

    names = [item.get("name") for item in headers]
    if any(not isinstance(name, str) or not name for name in names):
        raise ValueError("every report column needs a name")
    missing = [name for name in REQUIRED_COLUMNS if name not in names]
    if missing:
        raise ValueError(f"report is missing required columns: {', '.join(missing)}")

    elapsed_index = names.index("elapsedVideoTimeRatio")
    watch_index = names.index("audienceWatchRatio")
    points: list[Point] = []
    for row_number, row in enumerate(rows, start=1):
        if not isinstance(row, list) or len(row) != len(headers):
            raise ValueError(f"report row {row_number} does not match its column headers")
        try:
            elapsed = float(row[elapsed_index])
            watch = float(row[watch_index])
        except (TypeError, ValueError) as error:
            raise ValueError(f"report row {row_number} contains a non-numeric ratio") from error
        if not math.isfinite(elapsed) or not 0 <= elapsed <= 1:
            raise ValueError(f"report row {row_number} has an invalid elapsedVideoTimeRatio")
        if not math.isfinite(watch) or watch < 0:
            raise ValueError(f"report row {row_number} has an invalid audienceWatchRatio")
        points.append(Point(round(elapsed * duration, 6), round(watch * 100, 6)))

    points.sort(key=lambda point: point.time)
    if any(current.time <= previous.time for previous, current in zip(points, points[1:])):
        raise ValueError("report elapsedVideoTimeRatio values must be unique")
    return points


def write_csv(points: list[Point], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(("time", "retention"))
        writer.writerows((f"{point.time:g}", f"{point.retention:g}") for point in points)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert YouTube Analytics retention JSON to RetentionDNA CSV")
    parser.add_argument("--report", type=Path, required=True, help="saved reports.query JSON response")
    parser.add_argument("--duration", type=float, required=True, help="video duration in seconds")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    payload = json.loads(args.report.read_text(encoding="utf-8"))
    points = points_from_report(payload, args.duration)
    write_csv(points, args.out)
    print(json.dumps({"points": len(points), "csv": str(args.out)}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
