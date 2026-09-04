"""Read-only compatibility audit for real video files."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from retentiondna import detect_scene_changes, detect_silences


def inspect_media(video: Path) -> dict:
    if not video.is_file():
        raise ValueError(f"video does not exist: {video}")
    completed = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration,format_name:stream=codec_type,codec_name,width,height,channels,sample_rate",
            "-of", "json", str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)
    streams = payload.get("streams", [])
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), None)
    if not video_stream:
        raise ValueError("source file does not contain a video stream")
    audio_stream = next((item for item in streams if item.get("codec_type") == "audio"), None)
    silences = detect_silences(video)
    scenes = detect_scene_changes(video, threshold=0.3)
    return {
        "file": str(video),
        "durationSeconds": round(float(payload["format"]["duration"]), 3),
        "container": payload["format"].get("format_name"),
        "video": {
            "codec": video_stream.get("codec_name"),
            "width": video_stream.get("width"),
            "height": video_stream.get("height"),
        },
        "audio": None if not audio_stream else {
            "codec": audio_stream.get("codec_name"),
            "channels": audio_stream.get("channels"),
            "sampleRate": audio_stream.get("sample_rate"),
        },
        "evidence": {
            "silences": len(silences),
            "sceneChanges": len(scenes),
            "longestSilenceSeconds": max((item.duration for item in silences), default=0),
        },
        "compatible": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit real video compatibility without modifying the source")
    parser.add_argument("videos", nargs="+", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args(argv)
    results = [inspect_media(video) for video in args.videos]
    encoded = json.dumps({"files": results}, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(2)
