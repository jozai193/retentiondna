# RetentionDNA validation strategy

RetentionDNA validates different claims with different evidence. A single synthetic clip cannot prove that an edit will improve every video, so the project keeps these layers separate.

## 1. Real viewer-behavior curve benchmark

The external [vRetention dataset](https://github.com/flowtele/vRetention), documented in its [ACM MMSys 2024 paper](https://yihchun.com/papers/vretention.pdf), contains public YouTube `most replayed` heat-map SVG paths for 199,041 videos across 15 categories and 20 countries. It is useful for testing whether RetentionDNA can parse varied real-world curve shapes and consistently identify localized replay signals.

It is **not** private YouTube Studio audience retention and cannot validate why viewers left or whether a proposed edit will improve a future upload. The dataset and its GPL-licensed analysis code are not bundled or copied into this repository.

After downloading `youtube.csv` from the dataset's official repository, run a bounded external benchmark:

```powershell
python -B engine/vretention_benchmark.py `
  --dataset C:\path\to\youtube.csv `
  --limit 1000 `
  --seed 20260905 `
  --max-error-rate 0.1 `
  --out artifacts/vretention-summary.json
```

The clean-room adapter uses deterministic reservoir sampling rather than the dataset's first rows, parses the documented SVG path field, normalizes it to the video timeline, and reports representative failures, error rate, detected dips/spikes, and category/country coverage. It exits nonzero when no rows parse or the configured error-rate threshold is exceeded. Its report explicitly labels the result as signal-extraction testing rather than outcome validation.

## 2. Real media compatibility

The renderer and FFmpeg evidence extractors are tested independently of retention correctness. The repository's narrated 1080p product walkthrough contains real speech, screen motion, H.264 video, and AAC audio—not generated humming. Audit it without modifying the source:

```powershell
python -B engine/validate_media.py submission/retentiondna-demo.mp4 `
  --out artifacts/media-validation.json
```

Automated integration tests additionally cover video with no audio, measured silence, invalid intervals, the 35% destructive-edit safety limit, real replay-teaser rendering, unknown-operation rejection, and source fingerprint verification.

## 3. Official creator analytics

YouTube's [channel report](https://developers.google.com/youtube/analytics/channel_reports) requires OAuth authorization by the channel owner. Its audience-retention report uses `elapsedVideoTimeRatio` with `audienceWatchRatio`; the [official metric definition](https://developers.google.com/youtube/analytics/metrics) notes that segments can exceed 1.0 when viewers replay them.

`engine/youtube_analytics.py` now validates and converts the official `reports.query` JSON response without handling or storing OAuth credentials:

```powershell
python -B engine/youtube_analytics.py `
  --report C:\path\to\youtube-report.json `
  --duration 420 `
  --out artifacts\creator-retention.csv
```

When a channel is available, the remaining connector only needs to obtain consent, request the single-video report, determine video duration, and pass the response into this tested boundary.

The hosted workspace can also import a saved official `reports.query` JSON response directly. OAuth secrets and tokens remain outside the project.

## 4. Cross-runtime contract

The browser and Python engine run the same fixtures from `fixtures/golden-retention-cases.json`. These cases distinguish explicit percentages, generic decimal ratios, official YouTube ratio headers, and short second-based timelines. Edit plans use the versioned schema in `contracts/retentiondna.edit-plan.v2.schema.json` and bind to the exact source by size, duration, and SHA-256.

## Claims we can and cannot make

| Claim                                                           | Current evidence                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| RetentionDNA parses official API-shaped reports safely          | Automated fixtures and validation tests                             |
| Curve processing survives varied real YouTube replay shapes     | External vRetention benchmark harness; dataset run pending          |
| The media pipeline handles real spoken/visual footage           | Narrated product walkthrough audit                                  |
| Deterministic cuts and teaser promotions obey safety limits    | FFmpeg integration and source-identity tests                        |
| Browser and engine agree on retention units                    | Shared golden fixture corpus                                        |
| A recommendation improves a creator's future audience retention | Requires creator-owned A/B or before/after uploads; not yet claimed |
