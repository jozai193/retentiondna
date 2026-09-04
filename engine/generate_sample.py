"""Generate the reproducible RetentionDNA judge sample with FFmpeg.

The clip intentionally contains a long setup, a measured silent pause, clear
scene changes, and a later payoff. That makes every evidence label in the demo
traceable to the media instead of being decorative sample data.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "demo" / "retentiondna-sample.mp4"

SEGMENTS = [
    (12, "0x17211c", "PROMISE", "Plan a week of content in ten minutes", 330),
    (8, "0x25201a", "BACKGROUND", "Before we begin, here is my story", 260),
    (7, "0x321e1a", "DEAD AIR", "Seven seconds with no spoken value", None),
    (5, "0x25201a", "STILL SETTING UP", "More context before the first step", 260),
    (18, "0x15232d", "STEP 01", "Capture ideas and score audience intent", 390),
    (20, "0x132923", "STEP 02", "Sequence ideas so each creates demand", 440),
    (14, "0x213017", "PAYOFF", "Evidence replaces the blank page", 520),
    (16, "0x181d22", "FINISH", "Keep the best hook and schedule", 350),
]


def main() -> int:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is required")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    font = "C\\:/Windows/Fonts/segoeui.ttf"
    with tempfile.TemporaryDirectory(prefix="retentiondna-") as directory:
        scratch = Path(directory)
        segment_paths: list[Path] = []
        for index, (duration, color, title, subtitle, frequency) in enumerate(SEGMENTS):
            path = scratch / f"segment-{index:02d}.mp4"
            audio = (
                f"anullsrc=r=48000:cl=stereo:d={duration}"
                if frequency is None
                else f"sine=frequency={frequency}:sample_rate=48000:duration={duration}"
            )
            video_filter = (
                "drawgrid=width=80:height=80:thickness=1:color=white@0.035,"
                f"drawtext=fontfile='{font}':text='{title}':fontcolor=0xb7ff52:fontsize=24:x=58:y=54,"
                f"drawtext=fontfile='{font}':text='{subtitle}':fontcolor=white:fontsize=36:x=58:y=(h-text_h)/2,"
                f"drawtext=fontfile='{font}':text='RETENTIONDNA  /  JUDGE SAMPLE':fontcolor=white@0.45:fontsize=16:x=58:y=h-58,"
                "format=yuv420p"
            )
            subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "lavfi", "-i", f"color=c={color}:s=960x540:r=24:d={duration}",
                    "-f", "lavfi", "-i", audio,
                    "-vf", video_filter, "-af", "volume=0.35", "-shortest",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-c:a", "aac", "-b:a", "96k", "-ac", "2", str(path),
                ],
                check=True,
            )
            segment_paths.append(path)

        concat_file = scratch / "segments.txt"
        concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in segment_paths), encoding="utf-8")
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", str(concat_file),
                "-c", "copy", "-movflags", "+faststart", str(OUTPUT),
            ],
            check=True,
        )
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
