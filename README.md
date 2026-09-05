# RetentionDNA

RetentionDNA turns audience-retention evidence into concrete video edits. It aligns a retention curve to the source timeline, detects large local dips and spikes, explains the editing pattern around each signal, previews a safer cut, and exports an auditable edit plan that can be rendered with FFmpeg.

**Live demo:** https://retentiondna.advikmjevoor.chatgpt.site  
**Narrated walkthrough:** [download the public 1080p demo](https://github.com/jozai193/retentiondna/releases/download/v0.1.0-hackathon/retentiondna-demo.mp4)

**Synthetic smoke-test result:** RetentionDNA aligns a deliberately generated 30.5-point drop at 00:25 with 7.022 seconds of measured silence, three nearby scene transitions, and repeated setup language. It recommends a bounded 12.0–28.022 second repair and renders the 100.021-second draft to an 83.999-second better cut. This proves timeline alignment and deterministic rendering, not universal recommendation accuracy.

## Product contract

The hackathon demo proves one complete loop:

1. Load a source video and a retention CSV or official YouTube Analytics JSON response.
2. Detect audience-loss and replay signals deterministically.
3. Inspect each signal on the synchronized video timeline.
4. Stage a recommended repair and preview the cut without mutating the source.
5. Export a source-bound edit-decision JSON with the video's SHA-256 fingerprint.
6. Render safe removals or a replay-spike teaser into a new MP4 with the local engine.
7. Compare a later retention curve at the same moment and build a device-local pattern history.

The product never claims that an edit guarantees future retention. It distinguishes measured historical evidence from heuristic recommendations.

## Architecture

```text
Browser workspace
  ├─ local video object URL (the upload never leaves the browser)
  ├─ canonical timestamp, percentage, and ratio units
  ├─ CSV and official YouTube Analytics JSON adapters
  ├─ reducer-backed analyze / repair / error state machine
  ├─ retention change detector
  ├─ measured / aligned / unavailable evidence provenance
  ├─ interactive synchronized timeline
  ├─ non-destructive remove and promotion previews
  ├─ device-local Creator DNA pattern memory
  ├─ observed before/after retention comparison
  └─ source-bound edit-plan v2 export
                  │
                  ▼
Local rendering engine (Python standard library + FFmpeg)
  ├─ validate video duration with ffprobe
  ├─ detect silence and scene changes with FFmpeg
  ├─ measure transcript pace, filler, and repetition
  ├─ align multimodal evidence to each retention signal
  ├─ merge overlapping safe-remove operations
  ├─ verify source size, duration, and SHA-256 before rendering
  ├─ reject unknown, invalid, or >35%-destructive edit plans
  ├─ prepend a bounded teaser for replay-spike promotions
  ├─ construct a deterministic FFmpeg filter graph
  └─ render a new MP4 while preserving the source
```

The hosted experience performs the complete CSV analysis and non-destructive preview client-side. Native rendering is intentionally local because video files are large, creators need privacy, and a short-lived serverless worker is the wrong execution environment for FFmpeg.

## Run the web workspace

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. A built-in sample is ready immediately, or use **Upload project** with a local video and retention file.

Supported CSV headers:

- `time` or `timestamp`, expressed as seconds or `MM:SS`
- `retention`, expressed as a percentage or decimal ratio
- YouTube API-style `elapsedVideoTimeRatio` plus `audienceWatchRatio`
- A saved official `reports.query` JSON response containing those two columns

Explicit values such as `1.4%` remain 1.4%. Unitless generic values at or below 1.5 are treated as decimal ratios for backwards compatibility; official ratio headers are always treated as ratios, including replay values above 1.0.

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

FFmpeg and ffprobe must be on `PATH`. Rendering uses argument arrays, a constrained v2 schema, validated timestamps, and a source fingerprint. Generated text is never executed as a shell command.

## Verify

```powershell
npm test
npm run lint:all
npm run build
```

See [VALIDATION.md](VALIDATION.md) for the real YouTube heat-map benchmark, real narrated-media audit, official Analytics report adapter, and the exact boundary between compatibility evidence and outcome validation.

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
- **M6 — Trust and learning:** source-bound plans, evidence provenance, real spike promotion, observed outcome comparison, and device-local cross-project patterns.

## Honest MVP boundaries

- The browser performs curve analysis and synchronized transcript review. The local engine adds real silence, scene-change, speech-pace, filler, and repetition evidence; the hosted UI marks those channels unavailable when they were not measured.
- The web preview and renderer support safe remove edits and one bounded replay-spike teaser. The source remains unchanged.
- The official YouTube Analytics response adapter is implemented and tested. OAuth consent and live channel retrieval remain pending until a channel owner can authorize access; CSV import keeps the core demo reliable in the meantime.
- Creator DNA stores only small analysis summaries in the current browser's local storage. It never stores video or transcript content.
