# RetentionDNA

RetentionDNA turns audience-retention evidence into concrete video edits. It aligns a retention curve to the source timeline, detects large local dips and spikes, explains the editing pattern around each signal, previews a safer cut, and exports an auditable edit plan that can be rendered with FFmpeg.

**Live demo:** https://retentiondna.advikmjevoor.chatgpt.site  
**Narrated walkthrough:** [download the public 1080p demo](https://github.com/jozai193/retentiondna/releases/download/v0.1.0-hackathon/retentiondna-demo.mp4)

**Live real-data case:** the workspace opens on a public ACAU YouTube video and 100 audience-retention measurements published through Uruguay's government open-data catalog. RetentionDNA detects its strongest local loss at 01:18. The separate synthetic engineering fixture remains available only to demonstrate deterministic preview and rendering.

## Product contract

The hackathon demo proves one complete loop:

1. Load a source video and a retention CSV or official YouTube Analytics JSON response.
2. Infer or select a content profile and calculate a curve-relative anomaly threshold.
3. Detect audience-loss and replay signals and classify each moment's likely content role.
4. Apply tutorial, documentary, podcast, short-form, gaming, music, or general editing policy.
5. Inspect each signal on the synchronized video timeline.
6. Stage a recommended repair and preview the cut without mutating the source.
7. Export a source-bound edit-decision JSON with the video's SHA-256 fingerprint.
8. Render safe removals or a replay-spike teaser into a new MP4 with the local engine.
9. Compare a later retention curve, rate the recommendation, and build a device-local pattern history.

The product never claims that an edit guarantees future retention. It distinguishes measured historical evidence from heuristic recommendations.

## Architecture

```text
Browser workspace
  ├─ local video object URL (the upload never leaves the browser)
  ├─ canonical timestamp, percentage, and ratio units
  ├─ CSV and official YouTube Analytics JSON adapters
  ├─ reducer-backed analyze / repair / error state machine
  ├─ adaptive, rolling-baseline retention change detector
  ├─ automatic or creator-selected content profiles
  ├─ semantic moment classification and profile-specific editing policies
  ├─ measured / aligned / unavailable evidence provenance
  ├─ interactive synchronized timeline
  ├─ non-destructive remove and promotion previews
  ├─ device-local Creator DNA pattern and recommendation-feedback memory
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

Open `http://localhost:3000`. A verified public YouTube case backed by official ACAU open data is ready immediately. Use **Synthetic fixture** to exercise the deterministic editing pipeline or **Upload project** with your own local video and retention file.

The content selector supports **Auto**, General, Tutorial, Documentary, Podcast / interview, Short-form, Gaming, and Music / performance. Auto uses duration, filename, and any supplied transcript. The selected policy changes the anomaly floor, semantic interpretation, editing rule, and proposed repair while preserving the measured curve.

Supported CSV headers:

- `time` or `timestamp`, expressed as seconds or `MM:SS`
- `retention`, expressed as a percentage or decimal ratio
- YouTube API-style `elapsedVideoTimeRatio` plus `audienceWatchRatio`
- ACAU open-data `position_seconds`, `position_ratio`, or `position_percentage` plus `audience_ratio` or `audience_percentage`
- A saved official `reports.query` JSON response containing those two columns

Explicit values such as `1.4%` remain 1.4%. Unitless generic values at or below 1.5 are treated as decimal ratios for backwards compatibility; official ratio headers are always treated as ratios, including replay values above 1.0.

## Analyze and render locally

```powershell
python -B engine/retentiondna.py analyze `
  --video public/demo/retentiondna-sample.mp4 `
  --retention public/demo/retention.csv `
  --transcript public/demo/transcript.json `
  --profile tutorial `
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

See [VALIDATION.md](VALIDATION.md) for the official ACAU open-data case, real YouTube heat-map benchmark, narrated-media audit, official Analytics report adapter, and the exact boundary between compatibility evidence and outcome validation.

## Submission artifacts

- `submission/retentiondna-demo.mp4` — narrated 1080p demo (1:56.6)
- `submission/retentiondna-workspace.png` — primary judge screenshot
- `submission/retentiondna-better-cut.png` — staged repair screenshot
- `submission/DEVPOST.md` — ready-to-paste project story
- `submission/DEMO_SCRIPT.md` — shot list and narration structure
- `submission/CHECKLIST.md` — final publication and eligibility checks

## Implementation milestones

- **M1 — Working surface:** responsive forensic editing workspace, real public case, sample timeline, and evidence panel.
- **M2 — Real input:** local video upload, CSV parsing, normalized YouTube ratio support, error states.
- **M3 — Analysis:** adaptive dip/spike detection, content profiles, semantic moment roles, confidence/severity, and synchronized inspection.
- **M4 — Repair:** non-destructive cut preview, edit-plan export, deterministic FFmpeg renderer.
- **M5 — Submission:** deploy the interactive sample, record a concise before/after demo, publish repository and Devpost story.
- **M6 — Trust and learning:** source-bound plans, evidence provenance, real spike promotion, observed outcome comparison, accept/reject learning, and device-local format-aware patterns.

## Honest MVP boundaries

- The browser performs curve analysis and synchronized transcript review. The local engine adds real silence, scene-change, speech-pace, filler, and repetition evidence; the hosted UI marks those channels unavailable when they were not measured.
- The web preview and renderer support safe remove edits and one bounded replay-spike teaser. The source remains unchanged.
- The official YouTube Analytics response adapter is implemented and tested. OAuth consent and live channel retrieval remain pending until a channel owner can authorize access; CSV import keeps the core demo reliable in the meantime.
- Creator DNA stores only small analysis summaries in the current browser's local storage. It never stores video or transcript content.
- Content-profile inference and semantic roles are deterministic heuristics, not trained genre labels. The creator can override the profile and reject a recommendation; rejected formats switch to review-first copy on that device.
