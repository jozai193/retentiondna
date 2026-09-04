# RetentionDNA — Devpost submission draft

## Tagline

Audience-informed editing for every next upload.

## Elevator pitch (under 200 characters)

RetentionDNA aligns retention drops and replays with video, audio, and transcript evidence—then previews and renders a safer next cut with an auditable edit plan.

## Inspiration

Creator tools are good at generating more content, but weak at learning from what an audience actually watched. A retention graph can show *where* viewers left or replayed, yet creators still scrub the timeline and guess *why*. We wanted to close that loop: turn the previous upload's behavioral evidence into a concrete, reviewable edit for the next one.

## What it does

RetentionDNA accepts a draft video, an audience-retention CSV, and an optional timestamped transcript. It detects meaningful dips and spikes, synchronizes each signal to the source timeline, and explains the nearby evidence. Its local analysis engine also measures silence, scene transitions, speech pace, filler words, and repetition.

For the strongest audience-loss signal, RetentionDNA proposes a bounded repair. The creator can preview the better cut without changing the source, export a human-readable JSON edit plan, and render a new MP4 with a deterministic FFmpeg pipeline.

The built-in judge sample proves the full loop: a 30.5-point drop at 00:25 aligns with 7.022 seconds of silence, three nearby scene changes, and repeated setup language. RetentionDNA recommends removing 12.0–28.022 seconds and renders the 100.021-second draft to an 83.999-second better cut.

## How we built it

The responsive workspace uses React 19, TypeScript, Tailwind CSS, and shadcn/ui. CSV analysis runs entirely in the browser, including YouTube Analytics-style `elapsedVideoTimeRatio` and `audienceWatchRatio` data. Local uploads never leave the browser.

The evidence engine uses Python's standard library, FFprobe, and FFmpeg. `silencedetect` finds audio gaps; scene scores locate visual transitions; timestamped transcript features expose pace, filler, and repeated language. A deterministic renderer validates numeric intervals, merges overlaps, constructs a fixed trim/concat filter graph, and refuses plans that remove more than 35% of a source.

## Challenges we ran into

The hardest problem was staying honest about causality. A retention dip is observed behavior, but its cause is an inference. We designed the product to keep those layers separate: every signal shows measured evidence, every recommendation remains reviewable, and the UI states that an edit cannot guarantee future retention.

Rendering safely was another challenge. Instead of letting generated text become a shell command, RetentionDNA emits a constrained edit-plan schema. The renderer accepts only validated operations and builds the FFmpeg argument array itself.

## Accomplishments that we're proud of

- A complete analyze → inspect → repair → preview → export → render loop.
- Multimodal evidence that can be independently checked against the sample media.
- Privacy-first browser analysis and local rendering with no mandatory cloud account.
- Safety boundaries that preserve the source and reject destructive plans.
- A reproducible judge sample, automated tests, and a production build.

## What we learned

Creator analytics become much more useful when they are attached to editable moments instead of reported as aggregate metrics. We also learned that a strong AI product needs calibrated language: evidence and confidence are more trustworthy than a single unexplained “AI score.”

## What's next for RetentionDNA

Next we would add direct YouTube OAuth import, automatic transcription, face/shot-quality features, promotion rendering for replay spikes, and a memory layer that compares editing patterns across a creator's channel. The long-term goal is a personal editing model that learns from each upload without hiding the evidence behind its advice.

## Built with

React, TypeScript, Tailwind CSS, shadcn/ui, Python, FFmpeg, FFprobe, SVG, WebMCP

## Links to add before submission

- Live demo: `[pending deployment]`
- Source code: `[pending public repository]`
- Demo video: `[pending upload]`
