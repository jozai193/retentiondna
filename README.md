# RetentionDNA

RetentionDNA turns audience-retention evidence into concrete video edits. It aligns a retention curve to the source timeline, detects statistically meaningful dips and spikes, explains the editing pattern around each signal, previews a safer cut, and exports an auditable edit plan that can be rendered with FFmpeg.

## Product contract

The hackathon demo proves one complete loop:

1. Load a source video and timestamped audience-retention CSV.
2. Detect audience-loss and replay signals deterministically.
3. Inspect each signal on the synchronized video timeline.
4. Stage a recommended repair and preview the cut without mutating the source.
5. Export the edit-decision JSON.
6. Render the plan into a new MP4 with the local engine.

The product never claims that an edit guarantees future retention. It distinguishes measured historical evidence from heuristic recommendations.

## Architecture

```text
Browser workspace
  ├─ local video object URL (the upload never leaves the browser)
  ├─ CSV parser for timestamps or YouTube elapsedVideoTimeRatio
  ├─ retention change detector
  ├─ interactive synchronized timeline
  ├─ non-destructive edit preview
  └─ JSON edit-plan export
                  │
                  ▼
Local rendering engine (Python standard library + FFmpeg)
  ├─ validate video duration with ffprobe
  ├─ align transcript evidence
  ├─ merge overlapping safe-remove operations
  ├─ construct a deterministic FFmpeg filter graph
  └─ render a new MP4 while preserving the source
```

The hosted experience performs the complete CSV analysis and non-destructive preview client-side. Native rendering is intentionally local because video files are large, creators need privacy, and a short-lived serverless worker is the wrong execution environment for FFmpeg.

## Run the web workspace

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. A built-in sample is ready immediately, or use **Upload project** with a local video and CSV.

Supported CSV headers:

- `time` or `timestamp`, expressed as seconds or `MM:SS`
- `retention`, expressed as a percentage or decimal ratio
- YouTube API-style `elapsedVideoTimeRatio` plus `audienceWatchRatio`

## Analyze and render locally

```powershell
python -B engine/retentiondna.py analyze `
  --video public/demo/retentiondna-sample.mp4 `
  --retention public/demo/retention.csv `
  --transcript public/demo/transcript.json `
  --out artifacts/sample-plan.json

python -B engine/retentiondna.py render `
  --video public/demo/retentiondna-sample.mp4 `
  --plan artifacts/sample-plan.json `
  --out artifacts/sample-better-cut.mp4
```

FFmpeg and ffprobe must be on `PATH`. Rendering uses argument arrays and validated numeric timestamps; generated text is never executed as a shell command.

## Verify

```powershell
python -B -m unittest discover -s engine -p "test_*.py"
npm run build
```

## Implementation milestones

- **M1 — Working surface:** responsive forensic editing workspace, sample timeline, evidence panel.
- **M2 — Real input:** local video upload, CSV parsing, normalized YouTube ratio support, error states.
- **M3 — Analysis:** dip/spike detection, confidence/severity, synchronized inspection.
- **M4 — Repair:** non-destructive cut preview, edit-plan export, deterministic FFmpeg renderer.
- **M5 — Submission:** deploy the interactive sample, record a concise before/after demo, publish repository and Devpost story.

## Honest MVP boundaries

- The browser infers likely editing problems from retention-curve shape; transcript-aware diagnosis is available to the local engine when timestamped transcript JSON is provided.
- The web preview currently stages remove edits. The renderer supports safe remove operations; payoff promotion is represented in analysis but is not auto-rendered yet.
- Direct YouTube OAuth is a stretch goal. CSV import keeps the core demo reliable and avoids asking judges for channel access.
