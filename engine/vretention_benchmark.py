"""Benchmark signal extraction against the external vRetention dataset.

vRetention contains public YouTube ``most replayed`` heat-map SVG paths.  Those
paths are useful for testing curve parsing and replay-signal detection, but they
are not a substitute for a creator's private absolute audience-retention data.
The dataset is never bundled with RetentionDNA; pass a local ``youtube.csv``.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import re
import sys
from collections import Counter
from collections.abc import Iterable
from pathlib import Path

from retentiondna import Point, detect_signals


TOKEN = re.compile(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
ARG_COUNTS = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2}


def _bezier(start: tuple[float, float], controls: list[tuple[float, float]], end: tuple[float, float], steps: int = 8) -> list[tuple[float, float]]:
    result = []
    for index in range(1, steps + 1):
        t = index / steps
        if len(controls) == 1:
            control = controls[0]
            x = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t**2 * end[0]
            y = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t**2 * end[1]
        else:
            first, second = controls
            x = (1 - t) ** 3 * start[0] + 3 * (1 - t) ** 2 * t * first[0] + 3 * (1 - t) * t**2 * second[0] + t**3 * end[0]
            y = (1 - t) ** 3 * start[1] + 3 * (1 - t) ** 2 * t * first[1] + 3 * (1 - t) * t**2 * second[1] + t**3 * end[1]
        result.append((x, y))
    return result


def svg_path_vertices(path: str) -> list[tuple[float, float]]:
    """Flatten the line and Bezier commands used by YouTube heat-map paths."""
    tokens = TOKEN.findall(path.replace(",", " "))
    if not tokens:
        raise ValueError("empty SVG retention path")
    vertices: list[tuple[float, float]] = []
    index = 0
    command = ""
    current = (0.0, 0.0)
    subpath_start = current
    previous_control: tuple[float, float] | None = None

    def point(x: float, y: float, relative: bool) -> tuple[float, float]:
        return (current[0] + x, current[1] + y) if relative else (x, y)

    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
            if command.upper() == "Z":
                current = subpath_start
                vertices.append(current)
                previous_control = None
                continue
        if not command or command.upper() not in ARG_COUNTS:
            raise ValueError(f"unsupported SVG path command: {command or tokens[index]}")
        count = ARG_COUNTS[command.upper()]
        if index + count > len(tokens) or any(token.isalpha() for token in tokens[index:index + count]):
            raise ValueError(f"incomplete SVG path command: {command}")
        values = [float(token) for token in tokens[index:index + count]]
        if any(not math.isfinite(value) for value in values):
            raise ValueError("SVG path coordinates must be finite")
        index += count
        relative = command.islower()
        kind = command.upper()

        if kind == "M":
            current = point(values[0], values[1], relative)
            subpath_start = current
            vertices.append(current)
            command = "l" if relative else "L"
            previous_control = None
        elif kind == "L":
            current = point(values[0], values[1], relative)
            vertices.append(current)
            previous_control = None
        elif kind == "H":
            current = (current[0] + values[0], current[1]) if relative else (values[0], current[1])
            vertices.append(current)
            previous_control = None
        elif kind == "V":
            current = (current[0], current[1] + values[0]) if relative else (current[0], values[0])
            vertices.append(current)
            previous_control = None
        elif kind == "C":
            first = point(values[0], values[1], relative)
            second = point(values[2], values[3], relative)
            end = point(values[4], values[5], relative)
            vertices.extend(_bezier(current, [first, second], end))
            current, previous_control = end, second
        elif kind == "S":
            first = (2 * current[0] - previous_control[0], 2 * current[1] - previous_control[1]) if previous_control else current
            second = point(values[0], values[1], relative)
            end = point(values[2], values[3], relative)
            vertices.extend(_bezier(current, [first, second], end))
            current, previous_control = end, second
        elif kind == "Q":
            control = point(values[0], values[1], relative)
            end = point(values[2], values[3], relative)
            vertices.extend(_bezier(current, [control], end))
            current, previous_control = end, control
        elif kind == "T":
            control = (2 * current[0] - previous_control[0], 2 * current[1] - previous_control[1]) if previous_control else current
            end = point(values[0], values[1], relative)
            vertices.extend(_bezier(current, [control], end))
            current, previous_control = end, control

    if len(vertices) < 2:
        raise ValueError("SVG retention path needs at least two points")
    return vertices


def points_from_svg(path: str, duration: float, samples: int = 101) -> list[Point]:
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("video duration must be positive")
    if samples < 3:
        raise ValueError("at least three samples are required")
    raw = sorted(svg_path_vertices(path), key=lambda item: item[0])
    minimum_x, maximum_x = raw[0][0], raw[-1][0]
    if maximum_x <= minimum_x:
        raise ValueError("SVG retention path has no horizontal range")

    unique: list[tuple[float, float]] = []
    for x, y in raw:
        if unique and math.isclose(x, unique[-1][0], abs_tol=1e-9):
            # YouTube's filled heat-map path closes along y=100. At the two
            # vertical edges, the smaller y belongs to the visible curve.
            unique[-1] = (x, min(y, unique[-1][1]))
        else:
            unique.append((x, y))
    points: list[Point] = []
    cursor = 0
    for sample_index in range(samples):
        target = minimum_x + (maximum_x - minimum_x) * sample_index / (samples - 1)
        while cursor + 1 < len(unique) and unique[cursor + 1][0] < target:
            cursor += 1
        left = unique[cursor]
        right = unique[min(cursor + 1, len(unique) - 1)]
        ratio = 0.0 if right[0] == left[0] else (target - left[0]) / (right[0] - left[0])
        y = left[1] + (right[1] - left[1]) * ratio
        points.append(Point(round(duration * sample_index / (samples - 1), 6), round(max(0.0, min(100.0, 100.0 - y)), 6)))
    return points


def parse_duration(value: str) -> float:
    cleaned = value.strip()
    try:
        duration = float(cleaned)
    except ValueError:
        match = re.fullmatch(r"P(?:\d+D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?", cleaned)
        if not match:
            raise ValueError(f"unsupported duration: {value}")
        hours, minutes, seconds = (float(part or 0) for part in match.groups())
        duration = hours * 3600 + minutes * 60 + seconds
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration must be positive")
    return duration


def reservoir_sample(
    rows: Iterable[dict[str, str]],
    limit: int,
    seed: int,
) -> tuple[list[dict[str, str]], int]:
    randomizer = random.Random(seed)
    sample: list[dict[str, str]] = []
    count = 0
    for count, row in enumerate(rows, start=1):
        if len(sample) < limit:
            sample.append(row)
            continue
        replacement = randomizer.randrange(count)
        if replacement < limit:
            sample[replacement] = row
    return sample, count


def benchmark(
    dataset: Path,
    limit: int = 1000,
    seed: int = 20260905,
    max_error_rate: float = 0.1,
) -> dict:
    if limit <= 0:
        raise ValueError("limit must be positive")
    if not 0 <= max_error_rate <= 1:
        raise ValueError("max error rate must be between zero and one")
    parsed = 0
    errors = 0
    dips = 0
    spikes = 0
    countries: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    error_examples: list[dict[str, str]] = []
    with dataset.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"id", "duration", "retentionCurve"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("vRetention CSV needs id, duration, and retentionCurve columns")
        sampled_rows, dataset_rows = reservoir_sample(reader, limit, seed)
        for row in sampled_rows:
            try:
                points = points_from_svg(row["retentionCurve"], parse_duration(row["duration"]))
                signals = detect_signals(points)
                dips += sum(signal.kind == "dip" for signal in signals)
                spikes += sum(signal.kind == "spike" for signal in signals)
                countries[row.get("countryCode", "unknown") or "unknown"] += 1
                categories[row.get("categoryId", "unknown") or "unknown"] += 1
                parsed += 1
            except (TypeError, ValueError) as error:
                errors += 1
                if len(error_examples) < 5:
                    error_examples.append(
                        {
                            "id": row.get("id", "unknown") or "unknown",
                            "error": str(error),
                        }
                    )
    attempted = parsed + errors
    error_rate = errors / attempted if attempted else 1.0
    failure_reasons = []
    if not attempted:
        failure_reasons.append("dataset contains no data rows")
    if not parsed:
        failure_reasons.append("no rows parsed successfully")
    if error_rate > max_error_rate:
        failure_reasons.append(
            f"parse error rate {error_rate:.1%} exceeds {max_error_rate:.1%}"
        )
    return {
        "status": "failed" if failure_reasons else "passed",
        "source": "vRetention public YouTube most-replayed heat-map paths",
        "scope": "signal-extraction benchmark; not creator Studio retention or outcome validation",
        "sampling": {"method": "deterministic reservoir", "seed": seed, "datasetRows": dataset_rows},
        "attempted": attempted,
        "parsed": parsed,
        "errors": errors,
        "errorRate": round(error_rate, 4),
        "errorExamples": error_examples,
        "failureReasons": failure_reasons,
        "signals": {"dips": dips, "spikes": spikes},
        "coverage": {"countries": len(countries), "categories": len(categories)},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Benchmark RetentionDNA against an external vRetention YouTube CSV")
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=20260905)
    parser.add_argument("--max-error-rate", type=float, default=0.1)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    result = benchmark(args.dataset, args.limit, args.seed, args.max_error_rate)
    encoded = json.dumps(result, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if result["status"] == "passed" else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
