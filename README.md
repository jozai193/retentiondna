# RetentionDNA

RetentionDNA turns audience-retention evidence into concrete video edits. It aligns a retention curve to the source timeline, detects statistically meaningful dips and spikes, explains the editing pattern around each signal, previews a safer cut, and exports an auditable edit plan that can be rendered with FFmpeg.

**Live demo:** https://retentiondna.advikmjevoor.chatgpt.site  
**Narrated walkthrough:** [submission/retentiondna-demo.mp4](submission/retentiondna-demo.mp4)

**Judge sample result:** RetentionDNA aligns a 30.5-point audience drop at 00:25 with 7.022 seconds of measured silence, three nearby scene transitions, and repeated setup language. It recommends a bounded 12.0–28.022 second repair and renders the 100.021-second draft to an 83.999-second better cut.

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
  ├─ detect silence and scene changes with FFmpeg
  ├─ measure transcript pace, filler, and repetition
  ├─ align multimodal evidence to each retention signal
  ├─ merge overlapping safe-remove operations
  ├─ reject invalid or >35%-destructive edit plans
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

The judge sample is reproducible:

```powershell
python -B engine/generate_sample.py
```

FFmpeg and ffprobe must be on `PATH`. Rendering uses argument arrays and validated numeric timestamps; generated text is never executed as a shell command.

## Verify

```powershell
python -B -m unittest discover -s engine -p "test_*.py"
npm run build
```

## Submission artifacts

- `submission/retentiondna-demo.mp4` — narrated 1080p demo (1:56.6)
- `submission/retentiondna-workspace.png` — primary judge screenshot
- `submission/retentiondna-better-cut.png` — staged repair screenshot
- `submission/DEVPOST.md` — ready-to-paste project story
- `submission/DEMO_SCRIPT.md` — shot list and narration structure
- `submission/CHECKLIST.md` — final publication and eligibility checks

## Implementation milestones

- **M1 — Working surface:** responsive forensic editing workspace, sample timeline, evidence panel.
- **M2 — Real input:** local video upload, CSV parsing, normalized YouTube ratio support, error states.
- **M3 — Analysis:** dip/spike detection, confidence/severity, synchronized inspection.
- **M4 — Repair:** non-destructive cut preview, edit-plan export, deterministic FFmpeg renderer.
- **M5 — Submission:** deploy the interactive sample, record a concise before/after demo, publish repository and Devpost story.

## Honest MVP boundaries

- The browser performs curve analysis and synchronized transcript review. The local engine adds real silence, scene-change, speech-pace, filler, and repetition evidence.
- The web preview currently stages remove edits. The renderer supports safe remove operations; payoff promotion is represented in analysis but is not auto-rendered yet.
- Direct YouTube OAuth is a stretch goal. CSV import keeps the core demo reliable and avoids asking judges for channel access.
