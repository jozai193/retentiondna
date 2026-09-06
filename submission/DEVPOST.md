# RetentionDNA — Devpost submission draft

## Tagline

Audience-informed editing for every next upload.

## Elevator pitch (under 200 characters)

RetentionDNA aligns retention drops and replays with video, audio, and transcript evidence—then previews and renders a safer next cut with an auditable edit plan.

## Inspiration

Creator tools are good at generating more content, but weak at learning from what an audience actually watched. A retention graph can show _where_ viewers left or replayed, yet creators still scrub the timeline and guess _why_. We wanted to close that loop: turn the previous upload's behavioral evidence into a concrete, reviewable edit for the next one.

## What it does

RetentionDNA accepts a draft video, an audience-retention CSV or official YouTube Analytics JSON response, and an optional timestamped transcript. It automatically infers—or lets the creator select—the content format, calculates a curve-relative anomaly gate, detects meaningful dips and spikes, and classifies the nearby moment as a hook, setup, explanation, demonstration, payoff, transition, discussion, gameplay, or performance. Its guidance then adapts for tutorials, documentaries, podcasts, Shorts, gaming, music, or general content.

For an audience-loss signal, RetentionDNA proposes a bounded, format-aware test; for a replay spike, it can prepend a short teaser from the replayed moment. The creator can preview the better cut without changing the source, rate whether the recommendation fits, compare a later curve at the same timestamp, export a source-bound JSON edit plan, and render a new MP4 with a deterministic FFmpeg pipeline. Rejected recommendations make that content profile review-first on the current device.

The live workspace opens with a real public YouTube case from ACAU, Uruguay's national film and audiovisual agency. Its 100-point curve comes from ACAU's official open-data export of YouTube Analytics measurements. RetentionDNA identifies the strongest local loss at 01:18 and opens the real video at that moment. It marks the curve as measured while leaving transcript and scene evidence unavailable, because those were not supplied.

A separate, clearly labeled synthetic engineering fixture exercises the full edit loop: a deliberately generated 30.5-point drop at 00:25 aligns with 7.022 seconds of silence, three nearby scene changes, and repeated setup language. It proves timeline alignment and deterministic rendering, not universal recommendation accuracy.

## How we built it

The responsive workspace uses React 19, TypeScript, Tailwind CSS, and shadcn/ui. CSV and saved YouTube Analytics JSON analysis run entirely in the browser. Robust curve statistics set an adaptive threshold instead of treating every format identically. Deterministic keyword, duration, and timeline rules infer content and moment roles. A reducer prevents contradictory workflow states, and device-local Creator DNA stores only small project summaries and recommendation ratings—never videos or transcripts.

The evidence engine uses Python's standard library, FFprobe, and FFmpeg. `silencedetect` finds audio gaps; scene scores locate visual transitions; timestamped transcript features expose pace, filler, and repeated language. A deterministic renderer validates numeric intervals, verifies the selected source's size, duration, and SHA-256, rejects unknown actions, merges overlaps, renders removals or one bounded teaser, and refuses plans that remove more than 35% of a source.

We also built three independent real-data paths: native support for ACAU's official open-data schema, a clean-room adapter for the official YouTube Analytics retention response, and an external benchmark harness for the vRetention research dataset's public YouTube heat-map curves. External datasets are used to test parsing and signal extraction—not to claim causal or outcome accuracy.

## Challenges we ran into

The hardest problem was staying honest about causality. A retention dip is observed behavior, but its cause is an inference. We designed the product to keep those layers separate: every signal shows measured evidence, every recommendation remains reviewable, and the UI states that an edit cannot guarantee future retention.

Rendering safely was another challenge. Instead of letting generated text become a shell command, RetentionDNA emits a constrained edit-plan schema. The renderer accepts only validated operations and builds the FFmpeg argument array itself.

## Accomplishments that we're proud of

- A complete analyze → inspect → repair → compare → export → render loop.
- A live, publicly verifiable YouTube case backed by 100 official open-data retention measurements.
- Seven content policies, adaptive anomaly detection, semantic moment labels, and creator-overridable auto detection.
- A feedback loop that visibly changes future recommendations without uploading creator data.
- Multimodal alignment that can be independently checked against the synthetic sample media.
- Privacy-first browser analysis and local rendering with no mandatory cloud account.
- Safety boundaries that preserve the source and reject destructive, unsupported, or wrong-source plans.
- A reproducible smoke test, a real narrated-media compatibility audit, cross-runtime automated checks, and a production build.

## What we learned

Creator analytics become much more useful when they are attached to editable moments instead of reported as aggregate metrics. We also learned that a strong AI product needs calibrated language: evidence and confidence are more trustworthy than a single unexplained “AI score.”

## What's next for RetentionDNA

Next we would connect the tested YouTube Analytics response adapter to a live OAuth consent flow and add automatic transcription plus face/shot-quality features. Replay-spike promotion, device-local pattern memory, and observed outcome comparison are already working. The long-term goal is a personal editing model that learns from each upload without hiding the evidence behind its advice.

## Built with

React, TypeScript, Tailwind CSS, shadcn/ui, Python, FFmpeg, FFprobe, SVG, WebMCP

## Links to add before submission

- Live demo: https://retentiondna.advikmjevoor.chatgpt.site
- Source code: https://github.com/jozai193/retentiondna
- Public demo file: https://github.com/jozai193/retentiondna/releases/download/v0.1.0-hackathon/retentiondna-demo.mp4
- Devpost-compatible video host: `[pending YouTube or Vimeo upload]`
