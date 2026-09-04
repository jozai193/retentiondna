'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AudioLines,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileChartColumn,
  Film,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  ScanLine,
  Upload,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createEditDecisionList,
  detectRetentionSignals,
  formatTime,
  parseRetentionCsv,
  SAMPLE_RETENTION,
  type RetentionPoint,
  type RetentionSignal,
} from '@/lib/retention';

type TranscriptLine = { time: number; end: number; text: string };

const SAMPLE_TRANSCRIPT: TranscriptLine[] = [
  {
    time: 0,
    end: 12,
    text: 'Today I’ll show you the fastest way to plan a week of content.',
  },
  {
    time: 12,
    end: 20,
    text: 'So before we begin, here is basically the story behind this workflow.',
  },
  {
    time: 20,
    end: 27,
    text: '[silence]',
  },
  {
    time: 27,
    end: 32,
    text: 'Before we begin, there is just one more piece of context.',
  },
  {
    time: 32,
    end: 50,
    text: 'First, capture every idea in one place and score it by audience intent.',
  },
  {
    time: 50,
    end: 70,
    text: 'Then group related ideas into a sequence so each upload creates demand for the next.',
  },
  {
    time: 70,
    end: 84,
    text: 'The scoring step is the payoff: evidence replaces the blank page.',
  },
  {
    time: 84,
    end: 100,
    text: 'Finally, keep the strongest hook and schedule the week.',
  },
];

const FALLBACK_SIGNAL: RetentionSignal = {
  id: 'dip-25',
  type: 'dip',
  time: 25,
  endTime: 30,
  delta: -30.5,
  retention: 70,
  severity: 'high',
  title: 'The value arrives too late',
  explanation:
    'Viewer loss accelerates before the first minute, which indicates delayed value, repeated setup, or a promise mismatch.',
  learnedRule:
    'Deliver the first concrete payoff within 20 seconds and move personal context after it.',
  repair: {
    label: 'Tighten opening setup',
    start: 13,
    end: 31,
    action: 'remove',
    description:
      'Remove the repeated setup and measured silent pause, then bridge directly into step one.',
  },
};

export function RetentionWorkspace() {
  const initialSignals = useMemo(
    () => detectRetentionSignals(SAMPLE_RETENTION),
    [],
  );
  const [points, setPoints] = useState<RetentionPoint[]>(SAMPLE_RETENTION);
  const [signals, setSignals] = useState<RetentionSignal[]>(
    initialSignals.length ? initialSignals : [FALLBACK_SIGNAL],
  );
  const [selectedId, setSelectedId] = useState(
    strongestSignal(initialSignals).id,
  );
  const [sourceName, setSourceName] = useState('creator-workflow-draft.mp4');
  const [videoUrl, setVideoUrl] = useState('/demo/retentiondna-sample.mp4');
  const [duration, setDuration] = useState(100);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState('');
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [transcriptLines, setTranscriptLines] =
    useState<TranscriptLine[]>(SAMPLE_TRANSCRIPT);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [status, setStatus] = useState<'ready' | 'analyzing' | 'repaired'>(
    'ready',
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [cutMode, setCutMode] = useState<'original' | 'better'>('original');
  const videoRef = useRef<HTMLVideoElement>(null);

  const selected =
    signals.find((signal) => signal.id === selectedId) ??
    signals[0] ??
    FALLBACK_SIGNAL;
  const transcript = useMemo(
    () => transcriptAround(selected.time, transcriptLines),
    [selected.time, transcriptLines],
  );
  const evidence = useMemo(
    () =>
      evidenceFor(selected, videoUrl.startsWith('/demo/'), transcript.length),
    [selected, videoUrl, transcript.length],
  );
  const checkpointPoint = useMemo(
    () =>
      points.find((point) => point.time >= Math.min(30, duration)) ??
      points.at(-1) ?? { time: 0, retention: 0 },
    [duration, points],
  );

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'load_sample_analysis',
          title: 'Load sample analysis',
          description:
            'Load the built-in RetentionDNA sample and display its detected audience-retention signals.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async () => {
            const nextSignals = detectRetentionSignals(SAMPLE_RETENTION);
            setPoints(SAMPLE_RETENTION);
            setSignals(nextSignals.length ? nextSignals : [FALLBACK_SIGNAL]);
            setSelectedId(strongestSignal(nextSignals).id);
            setSourceName('creator-workflow-draft.mp4');
            setVideoUrl('/demo/retentiondna-sample.mp4');
            setDuration(100);
            setTranscriptLines(SAMPLE_TRANSCRIPT);
            setStatus('ready');
            setCutMode('original');
            return {
              loaded: true,
              points: SAMPLE_RETENTION.length,
              signals: Math.max(nextSignals.length, 1),
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  useEffect(
    () => () => {
      if (videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
    },
    [videoUrl],
  );

  function onVideoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setVideoFile(file);
  }

  async function onCsvChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setCsvFile(file);
    setCsvText(file ? await file.text() : '');
  }

  async function onTranscriptChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setTranscriptFile(file);
  }

  async function analyzeUpload() {
    setError('');
    if (!videoFile || !csvFile) {
      setError('Add both a video and its retention CSV.');
      return;
    }
    setStatus('analyzing');
    setProgress(14);
    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(videoFile);
      const videoDuration = await readVideoDuration(objectUrl);
      setProgress(42);
      const nextPoints = parseRetentionCsv(csvText, videoDuration);
      setProgress(72);
      const nextSignals = detectRetentionSignals(nextPoints);
      if (!nextSignals.length)
        throw new Error(
          'No meaningful dips or spikes were detected in this retention curve.',
        );
      const nextTranscript = transcriptFile
        ? parseTranscriptJson(await transcriptFile.text())
        : [];
      setPoints(nextPoints);
      setSignals(nextSignals);
      setSelectedId(strongestSignal(nextSignals).id);
      setDuration(videoDuration);
      setSourceName(videoFile.name);
      setTranscriptLines(nextTranscript);
      setCutMode('original');
      setVideoUrl((current) => {
        if (current.startsWith('blob:')) URL.revokeObjectURL(current);
        return objectUrl;
      });
      setProgress(100);
      setTimeout(() => setStatus('ready'), 350);
      setUploadOpen(false);
    } catch (caught) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not analyze these files.',
      );
      setStatus('ready');
      setProgress(0);
    }
  }

  function resetSample() {
    const nextSignals = detectRetentionSignals(SAMPLE_RETENTION);
    setPoints(SAMPLE_RETENTION);
    setSignals(nextSignals.length ? nextSignals : [FALLBACK_SIGNAL]);
    setSelectedId(strongestSignal(nextSignals).id);
    setSourceName('creator-workflow-draft.mp4');
    setVideoUrl('/demo/retentiondna-sample.mp4');
    setDuration(100);
    setTranscriptLines(SAMPLE_TRANSCRIPT);
    setStatus('ready');
    setCutMode('original');
  }

  function previewAt(time: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, time);
    void videoRef.current.play();
    setIsPlaying(true);
  }

  function togglePlayback() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) void videoRef.current.play();
    else videoRef.current.pause();
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || cutMode !== 'better' || selected.repair.action !== 'remove')
      return;
    if (
      video.currentTime >= selected.repair.start &&
      video.currentTime < selected.repair.end
    )
      video.currentTime = selected.repair.end;
  }

  function makeRepair() {
    setStatus('repaired');
    setCutMode('better');
    previewAt(Math.max(0, selected.repair.start - 4));
  }

  function downloadPlan() {
    const blob = new Blob(
      [JSON.stringify(createEditDecisionList(selected, sourceName), null, 2)],
      { type: 'application/json' },
    );
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${sourceName.replace(/\.[^.]+$/, '')}-retentiondna-plan.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-white/8 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_28px_rgba(183,255,82,.2)]">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-tight">
              RetentionDNA
            </p>
            <p className="text-xs text-muted-foreground">
              Audience-informed editing
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
            <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_rgba(183,255,82,.7)]" />
            {status === 'repaired' ? 'Better cut ready' : 'Analysis ready'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetSample}
            className="hidden text-muted-foreground md:flex"
          >
            <RotateCcw /> Sample
          </Button>
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger
              render={
                <Button
                  variant="outline"
                  className="border-white/10 bg-white/5"
                />
              }
            >
              <Upload /> Upload project
            </DialogTrigger>
            <DialogContent className="border-white/10 bg-[#111516] sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Analyze your retention data</DialogTitle>
                <DialogDescription>
                  Your files stay in this browser. RetentionDNA accepts
                  timestamp-based CSVs and YouTube Analytics ratios.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <FileInput
                  label="Draft video"
                  hint="MP4, WebM or MOV"
                  accept="video/*"
                  file={videoFile}
                  onChange={onVideoChange}
                  icon={<Film />}
                />
                <FileInput
                  label="Audience retention"
                  hint="CSV with time + retention columns"
                  accept=".csv,text/csv"
                  file={csvFile}
                  onChange={onCsvChange}
                  icon={<FileChartColumn />}
                />
                <FileInput
                  label="Transcript (optional)"
                  hint="JSON with start, end and text"
                  accept=".json,application/json"
                  file={transcriptFile}
                  onChange={onTranscriptChange}
                  icon={<Activity />}
                />
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-[#ff7d69]/30 bg-[#ff7d69]/8 px-3 py-2 text-sm text-[#ff9b89]"
                  >
                    {error}
                  </p>
                )}
                {status === 'analyzing' && (
                  <Progress value={progress}>
                    <ProgressLabel>Aligning signals</ProgressLabel>
                    <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                      {progress}%
                    </span>
                  </Progress>
                )}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setUploadOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={analyzeUpload}
                  disabled={status === 'analyzing'}
                >
                  {status === 'analyzing' ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <WandSparkles />
                  )}{' '}
                  Analyze files
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <section className="grid min-h-[calc(100vh-4rem)] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 border-r border-white/8 p-4 lg:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Analysis workspace</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em] sm:text-3xl">
                Why viewers left—and what to change next
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Tabs
                value={cutMode}
                onValueChange={(value) =>
                  setCutMode(value as 'original' | 'better')
                }
              >
                <TabsList>
                  <TabsTrigger value="original">Original</TabsTrigger>
                  <TabsTrigger value="better" disabled={status !== 'repaired'}>
                    Better cut
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Button onClick={() => setUploadOpen(true)}>
                <WandSparkles /> Analyze draft
              </Button>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/9 bg-card shadow-2xl shadow-black/25">
            <div className="relative aspect-video min-h-[260px] overflow-hidden bg-black">
              <video
                ref={videoRef}
                src={videoUrl}
                className="h-full w-full object-cover"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onTimeUpdate={handleTimeUpdate}
                onClick={togglePlayback}
                playsInline
              >
                <track
                  kind="captions"
                  src="/demo/sample-captions.vtt"
                  srcLang="en"
                  label="English"
                />
              </video>
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <button
                onClick={togglePlayback}
                aria-label={isPlaying ? 'Pause video' : 'Play video'}
                className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/45 backdrop-blur transition hover:scale-105 hover:border-primary/60"
              >
                {isPlaying ? (
                  <Pause className="h-6 w-6 fill-white" />
                ) : (
                  <Play className="ml-1 h-6 w-6 fill-white" />
                )}
              </button>
              <div className="absolute bottom-4 left-4 rounded-md border border-white/10 bg-black/55 px-2.5 py-1.5 font-mono text-xs text-white/80 backdrop-blur">
                {sourceName} · {formatTime(duration)}
              </div>
              {cutMode === 'better' && (
                <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border border-primary/25 bg-[#15200f]/90 px-3 py-1.5 text-xs text-primary">
                  <Zap className="h-3.5 w-3.5" /> Edit preview active
                </div>
              )}
            </div>
            <div className="border-t border-white/8 bg-[#0b0e0f] p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Audience retention</p>
                  <p className="text-xs text-muted-foreground">
                    Click a signal to inspect the evidence
                  </p>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>
                    <b className="mr-1 text-primary">
                      {Math.round(checkpointPoint.retention)}%
                    </b>{' '}
                    at {formatTime(checkpointPoint.time)}
                  </span>
                  <span>
                    <b className="mr-1 text-[#ff7d69]">
                      {Math.round(
                        Math.min(...signals.map((signal) => signal.delta)),
                      )}
                      %
                    </b>{' '}
                    largest dip
                  </span>
                </div>
              </div>
              <RetentionChart
                points={points}
                signals={signals}
                selectedId={selected.id}
                duration={duration}
                onSelect={(signal) => {
                  setSelectedId(signal.id);
                  previewAt(signal.time);
                }}
              />
            </div>
          </div>
          {transcript.length ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {transcript.map((line) => {
                const active =
                  selected.time >= line.time && selected.time <= line.end + 4;
                return (
                  <button
                    key={line.time}
                    onClick={() => previewAt(line.time)}
                    className={`rounded-xl border p-4 text-left transition hover:border-white/20 ${active ? 'border-[#ff7d69]/35 bg-[#ff7d69]/7' : 'border-white/8 bg-card'}`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatTime(line.time)}
                      </span>
                      {active && (
                        <CircleAlert className="h-4 w-4 text-[#ff7d69]" />
                      )}
                    </div>
                    <p className="text-sm leading-6 text-white/76">
                      {line.text}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-card p-5 text-sm text-muted-foreground">
              Curve-only analysis active. Add a timestamped transcript to ground
              each signal in the spoken content.
            </div>
          )}
        </div>
        <aside id="selected-signal" className="bg-[#0b0e0f] p-5 lg:p-6">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Selected signal</p>
            <span
              className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${selected.type === 'dip' ? 'bg-[#ff7d69]/10 text-[#ff9b89]' : 'bg-[#79c6ff]/10 text-[#8ed0ff]'}`}
            >
              {selected.severity.toUpperCase()} IMPACT
            </span>
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">
            {selected.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {selected.explanation}
          </p>
          <div
            className="mt-5 grid grid-cols-3 gap-2"
            aria-label="Aligned evidence"
          >
            {evidence.map((item) => (
              <EvidenceCue key={item.label} {...item} />
            ))}
          </div>
          <div className="my-6 grid grid-cols-3 gap-2">
            <Metric
              label={selected.type === 'dip' ? 'Drop' : 'Lift'}
              value={`${selected.delta > 0 ? '+' : ''}${Math.round(selected.delta)}%`}
              accent={selected.type === 'dip'}
            />
            <Metric label="Moment" value={formatTime(selected.time)} />
            <Metric
              label="Level"
              value={`${Math.round(selected.retention)}%`}
            />
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/[.055] p-4">
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">Learned editing rule</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {selected.learnedRule}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-6">
            <p className="text-sm font-medium">Recommended repair</p>
            <div className="mt-3 rounded-xl border border-white/9 bg-card p-4">
              <div className="flex gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/6">
                  {selected.type === 'dip' ? (
                    <Scissors className="h-4 w-4 text-primary" />
                  ) : (
                    <ChevronDown className="h-4 w-4 rotate-180 text-[#8ed0ff]" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">{selected.repair.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {selected.repair.description}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button className="flex-1" onClick={makeRepair}>
                  {status === 'repaired' ? <Check /> : <Scissors />}
                  {status === 'repaired'
                    ? 'Better cut ready'
                    : 'Create better cut'}
                </Button>
                <Button
                  variant="outline"
                  className="border-white/10 bg-white/5"
                  onClick={() =>
                    previewAt(Math.max(0, selected.repair.start - 3))
                  }
                >
                  Preview
                </Button>
              </div>
            </div>
          </div>
          {status === 'repaired' && (
            <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[.045] p-4">
              <div className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Repair staged</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Better-cut preview skips {formatTime(selected.repair.start)}
                    –{formatTime(selected.repair.end)}. Export the deterministic
                    edit plan for rendering.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="mt-3 w-full border-primary/20 bg-primary/5 text-primary"
                onClick={downloadPlan}
              >
                <Download /> Export edit plan
              </Button>
            </div>
          )}
          <div className="mt-8 border-t border-white/8 pt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Signals analyzed</span>
              <span className="font-mono">{signals.length}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Evidence coverage</span>
              <span className="font-mono text-primary">timeline aligned</span>
            </div>
          </div>
          <p className="mt-6 text-xs leading-5 text-muted-foreground">
            RetentionDNA suggests evidence-informed edits. It never guarantees
            future performance.
          </p>
        </aside>
      </section>
    </main>
  );
}

function RetentionChart({
  points,
  signals,
  selectedId,
  duration,
  onSelect,
}: {
  points: RetentionPoint[];
  signals: RetentionSignal[];
  selectedId: string;
  duration: number;
  onSelect: (signal: RetentionSignal) => void;
}) {
  const width = 800,
    height = 170,
    maxTime = Math.max(duration, points.at(-1)?.time ?? 1);
  const path = points
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'} ${(point.time / maxTime) * width} ${height - (Math.max(0, Math.min(110, point.retention)) / 110) * (height - 14)}`,
    )
    .join(' ');
  return (
    <div className="relative h-48 rounded-xl border border-white/7 bg-[#080a0b] p-3">
      <div className="absolute inset-x-3 top-1/4 border-t border-dashed border-white/8" />
      <div className="absolute inset-x-3 top-2/4 border-t border-dashed border-white/8" />
      <div className="absolute inset-x-3 top-3/4 border-t border-dashed border-white/8" />
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="relative h-full w-full overflow-visible"
        preserveAspectRatio="none"
        aria-label="Audience retention curve"
      >
        <defs>
          <linearGradient id="retentionFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b7ff52" stopOpacity=".32" />
            <stop offset="1" stopColor="#b7ff52" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${path} L${width} ${height} L0 ${height} Z`}
          fill="url(#retentionFill)"
        />
        <path
          d={path}
          fill="none"
          stroke="#b7ff52"
          strokeWidth="3"
          vectorEffect="non-scaling-stroke"
        />
        {signals.map((signal) => {
          const point = points.reduce(
            (best, candidate) =>
              Math.abs(candidate.time - signal.time) <
              Math.abs(best.time - signal.time)
                ? candidate
                : best,
            points[0],
          );
          const x = (signal.time / maxTime) * width,
            y = height - (point.retention / 110) * (height - 14),
            color = signal.type === 'dip' ? '#ff7d69' : '#79c6ff';
          return (
            <a
              key={signal.id}
              href="#selected-signal"
              aria-label={`${signal.type} at ${formatTime(signal.time)}`}
              onClick={(event) => {
                event.preventDefault();
                onSelect(signal);
              }}
              className="cursor-pointer"
            >
              <line
                x1={x}
                x2={x}
                y1="0"
                y2={height}
                stroke={color}
                strokeOpacity={signal.id === selectedId ? 0.8 : 0.24}
                strokeDasharray="5 5"
              />
              <circle
                cx={x}
                cy={y}
                r={signal.id === selectedId ? 8 : 5}
                fill={color}
                stroke="#080a0b"
                strokeWidth="3"
              />
            </a>
          );
        })}
      </svg>
      <div className="absolute inset-x-3 bottom-2 flex justify-between font-mono text-[10px] text-white/35">
        <span>00:00</span>
        <span>{formatTime(maxTime / 3)}</span>
        <span>{formatTime((maxTime * 2) / 3)}</span>
        <span>{formatTime(maxTime)}</span>
      </div>
    </div>
  );
}

function FileInput({
  label,
  hint,
  accept,
  file,
  onChange,
  icon,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  icon: React.ReactNode;
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-white/14 bg-white/[.025] p-4 transition hover:border-primary/40 hover:bg-primary/[.035]">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/6 text-muted-foreground group-hover:text-primary [&_svg]:h-5 [&_svg]:w-5">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{file?.name ?? label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : hint}
        </span>
      </span>
      {file ? (
        <Check className="h-5 w-5 text-primary" />
      ) : (
        <Upload className="h-4 w-4 text-muted-foreground" />
      )}
      <input
        type="file"
        accept={accept}
        className="sr-only"
        onChange={onChange}
      />
    </label>
  );
}

function Metric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[.025] p-3">
      <p
        className={`truncate font-mono text-lg ${accent ? 'text-[#ff8b77]' : 'text-white'}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
function EvidenceCue({
  label,
  value,
  kind,
}: {
  label: string;
  value: string;
  kind: 'curve' | 'audio' | 'visual';
}) {
  const Icon =
    kind === 'audio' ? AudioLines : kind === 'visual' ? ScanLine : Activity;
  return (
    <div className="rounded-lg border border-white/8 bg-white/[.025] p-3">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-2 truncate text-xs font-medium text-white/85">{value}</p>
      <p className="mt-1 truncate text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function evidenceFor(
  signal: RetentionSignal,
  sample: boolean,
  transcriptCount: number,
) {
  const curve = {
    label: 'Retention',
    value: `${signal.delta > 0 ? '+' : ''}${Math.round(signal.delta)} pts`,
    kind: 'curve' as const,
  };
  if (sample && signal.time >= 20 && signal.time <= 35) {
    return [
      curve,
      { label: 'Audio', value: '7.0s silence', kind: 'audio' as const },
      { label: 'Visual', value: '3 cuts nearby', kind: 'visual' as const },
    ];
  }
  return [
    curve,
    {
      label: 'Transcript',
      value: transcriptCount ? `${transcriptCount} aligned` : 'Not supplied',
      kind: 'audio' as const,
    },
    {
      label: 'Visual',
      value: sample ? 'Scene checked' : 'Browser preview',
      kind: 'visual' as const,
    },
  ];
}
function strongestSignal(signals: RetentionSignal[]): RetentionSignal {
  if (!signals.length) return FALLBACK_SIGNAL;
  return signals
    .slice(1)
    .reduce(
      (best, signal) =>
        Math.abs(signal.delta) > Math.abs(best.delta) ? signal : best,
      signals[0],
    );
}
function transcriptAround(
  time: number,
  lines: TranscriptLine[],
): TranscriptLine[] {
  if (!lines.length) return [];
  const found = lines.findIndex(
    (line) => time >= line.time && time <= line.end,
  );
  const activeIndex = Math.max(0, found);
  const start = Math.max(
    0,
    Math.min(activeIndex - 1, Math.max(0, lines.length - 3)),
  );
  return lines.slice(start, start + 3);
}
function parseTranscriptJson(text: string): TranscriptLine[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed))
    throw new Error('Transcript JSON must be an array.');
  const lines = parsed.map((item: unknown) => {
    if (!item || typeof item !== 'object')
      throw new Error('Each transcript item must be an object.');
    const candidate = item as {
      start?: unknown;
      end?: unknown;
      text?: unknown;
    };
    if (typeof candidate.text !== 'string')
      throw new Error('Each transcript item needs text.');
    return {
      time: Number(candidate.start),
      end: Number(candidate.end),
      text: candidate.text,
    };
  });
  if (
    lines.some(
      (line) =>
        !Number.isFinite(line.time) ||
        !Number.isFinite(line.end) ||
        line.time < 0 ||
        line.end <= line.time ||
        !line.text.trim(),
    )
  )
    throw new Error(
      'Each transcript item needs numeric start/end values and text.',
    );
  return lines.sort((a, b) => a.time - b.time);
}
function readVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0)
        resolve(video.duration);
      else reject(new Error('The selected video has an invalid duration.'));
    };
    video.onerror = () =>
      reject(new Error('The selected video could not be read.'));
    video.src = url;
  });
}

declare global {
  interface ModelContext {
    registerTool(
      tool: {
        name: string;
        title?: string;
        description: string;
        inputSchema: object;
        execute(input: unknown): Promise<unknown>;
        annotations?: {
          readOnlyHint?: boolean;
          untrustedContentHint?: boolean;
        };
      },
      options?: { signal?: AbortSignal },
    ): void | Promise<void>;
  }
}
