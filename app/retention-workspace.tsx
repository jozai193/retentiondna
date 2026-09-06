'use client';

import {
  ChangeEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  AudioLines,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleAlert,
  Database,
  Download,
  ExternalLink,
  FileChartColumn,
  Film,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  ScanLine,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
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
  CONTENT_PROFILES,
  contentProfileLabel,
  detectRetentionSignals,
  formatTime,
  inferContentProfile,
  momentLabel,
  parseRetentionInput,
  SAMPLE_RETENTION,
  type ContentProfile,
  type FeedbackPreference,
  type RetentionPoint,
  type RetentionSignal,
  type SourceIdentity,
} from '@/lib/retention';
import { ACAU_CASE } from '@/lib/acau-case';
import {
  alignedTranscriptWindow,
  evidenceFor,
  type EvidenceCueData,
  type TranscriptLine,
} from '@/lib/evidence';
import {
  initialWorkflowState,
  workflowReducer,
  type CutMode,
} from '@/lib/workflow';

type CreatorMemoryEntry = {
  sourceName: string;
  analyzedAt: string;
  duration: number;
  strongestType: 'dip' | 'spike';
  strongestTime: number;
  strongestDelta: number;
  profile?: ContentProfile;
};

type OutcomeComparison = {
  fileName: string;
  before: number;
  after: number;
  change: number;
};

type SourceMode = 'acau' | 'synthetic' | 'upload';

type ProfileMode = 'auto' | ContentProfile;

type RecommendationFeedback = {
  key: string;
  profile: ContentProfile;
  verdict: 'accepted' | 'rejected';
  recordedAt: string;
};

const CREATOR_MEMORY_KEY = 'retentiondna.creator-memory.v1';
const RECOMMENDATION_FEEDBACK_KEY = 'retentiondna.recommendation-feedback.v1';

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
  confidence: 0.97,
  profile: 'general',
  momentRole: 'setup',
  threshold: 7,
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
    () => detectRetentionSignals(ACAU_CASE.points, { profile: 'documentary' }),
    [],
  );
  const [points, setPoints] = useState<RetentionPoint[]>(ACAU_CASE.points);
  const [signals, setSignals] = useState<RetentionSignal[]>(
    initialSignals.length ? initialSignals : [FALLBACK_SIGNAL],
  );
  const [selectedId, setSelectedId] = useState(
    strongestSignal(initialSignals).id,
  );
  const [sourceMode, setSourceMode] = useState<SourceMode>('acau');
  const [profileMode, setProfileMode] = useState<ProfileMode>('auto');
  const [profile, setProfile] = useState<ContentProfile>('documentary');
  const [sourceName, setSourceName] = useState<string>(ACAU_CASE.title);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState<number>(ACAU_CASE.durationSeconds);
  const [youtubeStart, setYoutubeStart] = useState(0);
  const [youtubeAutoplay, setYoutubeAutoplay] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState('');
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [workflow, dispatchWorkflow] = useReducer(
    workflowReducer,
    initialWorkflowState,
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [exportState, setExportState] = useState<
    'idle' | 'hashing' | 'done' | 'error'
  >('idle');
  const [creatorMemory, setCreatorMemory] = useState<CreatorMemoryEntry[]>([]);
  const [recommendationFeedback, setRecommendationFeedback] = useState<
    RecommendationFeedback[]
  >([]);
  const [outcome, setOutcome] = useState<OutcomeComparison | null>(null);
  const [outcomeError, setOutcomeError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const promotionPhase = useRef<'idle' | 'teaser' | 'main'>('idle');
  const { phase: status, progress, error, cutMode } = workflow;

  const selected =
    signals.find((signal) => signal.id === selectedId) ??
    signals[0] ??
    FALLBACK_SIGNAL;
  const transcript = useMemo(
    () => alignedTranscriptWindow(selected.time, transcriptLines),
    [selected.time, transcriptLines],
  );
  const evidence = useMemo(
    () =>
      evidenceFor(
        selected,
        sourceMode === 'synthetic',
        transcript,
        transcriptLines.length > 0,
      ),
    [selected, sourceMode, transcript, transcriptLines.length],
  );
  const youtubeEmbedUrl = `https://www.youtube-nocookie.com/embed/${ACAU_CASE.videoId}?rel=0&modestbranding=1&start=${Math.floor(youtubeStart)}&autoplay=${youtubeAutoplay ? 1 : 0}`;
  const checkpointPoint = useMemo(
    () =>
      points.find((point) => point.time >= Math.min(30, duration)) ??
      points.at(-1) ?? { time: 0, retention: 0 },
    [duration, points],
  );
  const creatorInsight = useMemo(
    () => summarizeCreatorMemory(creatorMemory, recommendationFeedback),
    [creatorMemory, recommendationFeedback],
  );
  const feedbackKey = `${sourceName}|${profile}|${selected.type}|${Math.round(selected.time)}`;
  const selectedFeedback = recommendationFeedback.find(
    (item) => item.key === feedbackKey,
  );
  const inferredProfile = inferContentProfile({
    sourceName,
    duration,
    transcript: transcriptLines,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(CREATOR_MEMORY_KEY);
        if (saved) setCreatorMemory(parseCreatorMemory(saved));
        const savedFeedback = window.localStorage.getItem(
          RECOMMENDATION_FEEDBACK_KEY,
        );
        if (savedFeedback)
          setRecommendationFeedback(parseRecommendationFeedback(savedFeedback));
      } catch {
        // Device-local memory is optional; analysis remains fully functional.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'load_public_case_analysis',
          title: 'Load public retention case',
          description:
            'Load the verified public ACAU YouTube case and display signals detected from its official open retention curve.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async () => {
            const nextSignals = detectRetentionSignals(ACAU_CASE.points, {
              profile: 'documentary',
            });
            setPoints(ACAU_CASE.points);
            setSignals(nextSignals.length ? nextSignals : [FALLBACK_SIGNAL]);
            setSelectedId(strongestSignal(nextSignals).id);
            setSourceMode('acau');
            setProfileMode('auto');
            setProfile('documentary');
            setSourceName(ACAU_CASE.title);
            setVideoUrl('');
            setDuration(ACAU_CASE.durationSeconds);
            setYoutubeStart(0);
            setYoutubeAutoplay(false);
            setTranscriptLines([]);
            dispatchWorkflow({ type: 'RESET' });
            promotionPhase.current = 'idle';
            setOutcome(null);
            return {
              loaded: true,
              points: ACAU_CASE.points.length,
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
    if (!videoFile || !csvFile) {
      dispatchWorkflow({
        type: 'ANALYZE_FAILURE',
        message: 'Add both a video and its audience-retention file.',
      });
      return;
    }
    dispatchWorkflow({ type: 'ANALYZE_START' });
    let objectUrl = '';
    try {
      objectUrl = URL.createObjectURL(videoFile);
      const videoDuration = await readVideoDuration(objectUrl);
      dispatchWorkflow({ type: 'ANALYZE_PROGRESS', progress: 42 });
      const nextPoints = parseRetentionInput(
        csvText,
        csvFile.name,
        videoDuration,
      );
      dispatchWorkflow({ type: 'ANALYZE_PROGRESS', progress: 72 });
      const nextTranscript = transcriptFile
        ? parseTranscriptJson(await transcriptFile.text())
        : [];
      const nextProfile = inferContentProfile({
        sourceName: videoFile.name,
        duration: videoDuration,
        transcript: nextTranscript,
      });
      const nextSignals = detectRetentionSignals(nextPoints, {
        profile: nextProfile,
        transcript: nextTranscript,
        feedbackPreference: feedbackPreference(
          recommendationFeedback,
          nextProfile,
        ),
      });
      if (!nextSignals.length)
        throw new Error(
          'No meaningful dips or spikes were detected against this video’s adaptive baseline.',
        );
      setPoints(nextPoints);
      setSignals(nextSignals);
      setSelectedId(strongestSignal(nextSignals).id);
      setDuration(videoDuration);
      setSourceMode('upload');
      setProfileMode('auto');
      setProfile(nextProfile);
      setSourceName(videoFile.name);
      setTranscriptLines(nextTranscript);
      setVideoUrl((current) => {
        if (current.startsWith('blob:')) URL.revokeObjectURL(current);
        return objectUrl;
      });
      rememberCreatorProject(videoFile.name, videoDuration, nextSignals);
      setOutcome(null);
      setOutcomeError('');
      setExportState('idle');
      promotionPhase.current = 'idle';
      dispatchWorkflow({ type: 'ANALYZE_PROGRESS', progress: 100 });
      setTimeout(() => dispatchWorkflow({ type: 'ANALYZE_SUCCESS' }), 350);
      setUploadOpen(false);
    } catch (caught) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      promotionPhase.current = 'idle';
      dispatchWorkflow({
        type: 'ANALYZE_FAILURE',
        message:
          caught instanceof Error
            ? caught.message
            : 'Could not analyze these files.',
      });
    }
  }

  function loadAcauCase() {
    const nextSignals = detectRetentionSignals(ACAU_CASE.points, {
      profile: 'documentary',
      feedbackPreference: feedbackPreference(
        recommendationFeedback,
        'documentary',
      ),
    });
    setPoints(ACAU_CASE.points);
    setSignals(nextSignals.length ? nextSignals : [FALLBACK_SIGNAL]);
    setSelectedId(strongestSignal(nextSignals).id);
    setSourceMode('acau');
    setProfileMode('auto');
    setProfile('documentary');
    setSourceName(ACAU_CASE.title);
    setVideoUrl('');
    setDuration(ACAU_CASE.durationSeconds);
    setYoutubeStart(0);
    setYoutubeAutoplay(false);
    setTranscriptLines([]);
    setOutcome(null);
    setOutcomeError('');
    setExportState('idle');
    setIsPlaying(false);
    promotionPhase.current = 'idle';
    dispatchWorkflow({ type: 'RESET' });
  }

  function loadSyntheticFixture() {
    const nextSignals = detectRetentionSignals(SAMPLE_RETENTION, {
      profile: 'tutorial',
      transcript: SAMPLE_TRANSCRIPT,
      feedbackPreference: feedbackPreference(
        recommendationFeedback,
        'tutorial',
      ),
    });
    setPoints(SAMPLE_RETENTION);
    setSignals(nextSignals.length ? nextSignals : [FALLBACK_SIGNAL]);
    setSelectedId(strongestSignal(nextSignals).id);
    setSourceMode('synthetic');
    setProfileMode('auto');
    setProfile('tutorial');
    setSourceName('creator-workflow-draft.mp4');
    setVideoUrl('/demo/retentiondna-sample.mp4');
    setDuration(100);
    setTranscriptLines(SAMPLE_TRANSCRIPT);
    setOutcome(null);
    setOutcomeError('');
    setExportState('idle');
    promotionPhase.current = 'idle';
    dispatchWorkflow({ type: 'RESET' });
  }

  function previewAt(time: number) {
    if (sourceMode === 'acau') {
      setYoutubeStart(Math.max(0, time));
      setYoutubeAutoplay(true);
      return;
    }
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, time);
    void videoRef.current.play();
    setIsPlaying(true);
  }

  function togglePlayback() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      if (
        cutMode === 'better' &&
        selected.repair.action === 'promote' &&
        promotionPhase.current === 'idle'
      ) {
        promotionPhase.current = 'teaser';
        videoRef.current.currentTime = selected.repair.start;
      }
      void videoRef.current.play();
    } else videoRef.current.pause();
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video || cutMode !== 'better') return;
    if (selected.repair.action === 'remove') {
      if (
        video.currentTime >= selected.repair.start &&
        video.currentTime < selected.repair.end
      )
        video.currentTime = selected.repair.end;
      return;
    }
    if (
      promotionPhase.current === 'teaser' &&
      video.currentTime >= selected.repair.end
    ) {
      promotionPhase.current = 'main';
      video.currentTime = 0;
    }
  }

  function makeRepair() {
    dispatchWorkflow({ type: 'STAGE_REPAIR' });
    if (selected.repair.action === 'promote') {
      promotionPhase.current = 'teaser';
      previewAt(selected.repair.start);
    } else {
      promotionPhase.current = 'idle';
      previewAt(Math.max(0, selected.repair.start - 4));
    }
  }

  function selectCutMode(mode: CutMode) {
    dispatchWorkflow({ type: 'SET_CUT', cutMode: mode });
    if (mode === 'original') {
      promotionPhase.current = 'idle';
      previewAt(Math.max(0, selected.repair.start - 3));
    } else if (status === 'repaired') {
      if (selected.repair.action === 'promote') {
        promotionPhase.current = 'teaser';
        previewAt(selected.repair.start);
      } else previewAt(Math.max(0, selected.repair.start - 3));
    }
  }

  function selectSignal(signal: RetentionSignal) {
    setSelectedId(signal.id);
    promotionPhase.current = 'idle';
    setOutcome(null);
    dispatchWorkflow({ type: 'RESET' });
    previewAt(signal.time);
  }

  function onProfileChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextMode = event.target.value as ProfileMode;
    const nextProfile =
      nextMode === 'auto'
        ? inferContentProfile({
            sourceName,
            duration,
            transcript: transcriptLines,
          })
        : nextMode;
    const nextSignals = detectRetentionSignals(points, {
      profile: nextProfile,
      transcript: transcriptLines,
      feedbackPreference: feedbackPreference(
        recommendationFeedback,
        nextProfile,
      ),
    });
    setProfileMode(nextMode);
    setProfile(nextProfile);
    setSignals(nextSignals.length ? nextSignals : [FALLBACK_SIGNAL]);
    setSelectedId(strongestSignal(nextSignals).id);
    setOutcome(null);
    promotionPhase.current = 'idle';
    dispatchWorkflow({ type: 'RESET' });
  }

  function recordRecommendationFeedback(verdict: 'accepted' | 'rejected') {
    const entry: RecommendationFeedback = {
      key: feedbackKey,
      profile,
      verdict,
      recordedAt: new Date().toISOString(),
    };
    const next = [
      entry,
      ...recommendationFeedback.filter((item) => item.key !== feedbackKey),
    ].slice(0, 60);
    setRecommendationFeedback(next);
    try {
      window.localStorage.setItem(
        RECOMMENDATION_FEEDBACK_KEY,
        JSON.stringify(next),
      );
    } catch {
      // Feedback remains usable for this session when storage is unavailable.
    }
    const nextSignals = detectRetentionSignals(points, {
      profile,
      transcript: transcriptLines,
      feedbackPreference: feedbackPreference(next, profile),
    });
    setSignals(nextSignals.length ? nextSignals : [FALLBACK_SIGNAL]);
  }

  async function downloadPlan() {
    if (sourceMode === 'acau') return;
    setExportState('hashing');
    try {
      const sourceBlob = videoUrl.startsWith('/demo/')
        ? await fetch(videoUrl).then((response) => {
            if (!response.ok)
              throw new Error('Could not read the sample video.');
            return response.blob();
          })
        : videoFile;
      if (!sourceBlob)
        throw new Error('The source video is no longer available.');
      const source: SourceIdentity = {
        name: sourceName,
        sizeBytes: sourceBlob.size,
        durationSeconds: Number(duration.toFixed(3)),
        sha256: await sha256Hex(sourceBlob),
      };
      const blob = new Blob(
        [JSON.stringify(createEditDecisionList(selected, source), null, 2)],
        { type: 'application/json' },
      );
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${sourceName.replace(/\.[^.]+$/, '')}-retentiondna-plan.json`;
      anchor.click();
      URL.revokeObjectURL(anchor.href);
      setExportState('done');
    } catch {
      setExportState('error');
    }
  }

  async function onOutcomeChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setOutcomeError('');
    try {
      const nextPoints = parseRetentionInput(
        await file.text(),
        file.name,
        duration,
      );
      const before = retentionAt(points, selected.time);
      const after = retentionAt(nextPoints, selected.time);
      setOutcome({
        fileName: file.name,
        before,
        after,
        change: after - before,
      });
    } catch (caught) {
      setOutcome(null);
      setOutcomeError(
        caught instanceof Error
          ? caught.message
          : 'Could not compare this result.',
      );
    }
  }

  function rememberCreatorProject(
    name: string,
    projectDuration: number,
    projectSignals: RetentionSignal[],
  ) {
    const strongest = strongestSignal(projectSignals);
    const entry: CreatorMemoryEntry = {
      sourceName: name,
      analyzedAt: new Date().toISOString(),
      duration: projectDuration,
      strongestType: strongest.type,
      strongestTime: strongest.time,
      strongestDelta: strongest.delta,
      profile,
    };
    setCreatorMemory((current) => {
      const next = [
        entry,
        ...current.filter((item) => item.sourceName !== name),
      ].slice(0, 12);
      try {
        window.localStorage.setItem(CREATOR_MEMORY_KEY, JSON.stringify(next));
      } catch {
        // Device-local memory is optional.
      }
      return next;
    });
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
            onClick={
              sourceMode === 'acau' ? loadSyntheticFixture : loadAcauCase
            }
            aria-label={
              sourceMode === 'acau'
                ? 'Load synthetic fixture'
                : 'Load real case'
            }
            className="text-muted-foreground"
          >
            <RotateCcw />
            <span className="hidden md:inline">
              {sourceMode === 'acau' ? 'Synthetic fixture' : 'Real case'}
            </span>
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
                  hint="CSV or official YouTube Analytics JSON"
                  accept=".csv,.json,text/csv,application/json"
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
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[.035] px-2.5 text-xs text-muted-foreground">
                <span className="hidden sm:inline">Content</span>
                <select
                  aria-label="Content profile"
                  value={profileMode}
                  onChange={onProfileChange}
                  className="max-w-36 bg-transparent font-medium text-white outline-none"
                >
                  <option value="auto" className="bg-[#111516]">
                    Auto · {contentProfileLabel(inferredProfile)}
                  </option>
                  {CONTENT_PROFILES.map((item) => (
                    <option
                      key={item.value}
                      value={item.value}
                      className="bg-[#111516]"
                    >
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <Tabs
                value={cutMode}
                onValueChange={(value) => selectCutMode(value as CutMode)}
              >
                <TabsList>
                  <TabsTrigger value="original">Original</TabsTrigger>
                  <TabsTrigger
                    value="better"
                    disabled={sourceMode === 'acau' || status !== 'repaired'}
                  >
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
            <div className="relative aspect-video overflow-hidden bg-black">
              {sourceMode === 'acau' ? (
                <iframe
                  key={youtubeEmbedUrl}
                  src={youtubeEmbedUrl}
                  title={`${ACAU_CASE.title} on YouTube`}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; compute-pressure; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className="h-full w-full object-contain"
                    preload="metadata"
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onTimeUpdate={handleTimeUpdate}
                    onClick={togglePlayback}
                    playsInline
                  >
                    <track
                      kind="captions"
                      src={
                        sourceMode === 'synthetic'
                          ? '/demo/sample-captions.vtt'
                          : '/demo/empty-captions.vtt'
                      }
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
                  <div className="absolute bottom-3 left-3 max-w-[70%] truncate rounded-md border border-white/10 bg-black/55 px-2.5 py-1.5 font-mono text-xs text-white/80 backdrop-blur sm:bottom-4 sm:left-4">
                    {sourceName} · {formatTime(duration)}
                  </div>
                </>
              )}
              {sourceMode === 'synthetic' && cutMode === 'original' && (
                <div className="absolute right-2 top-2 max-w-[calc(100%-1rem)] rounded-full border border-amber-300/25 bg-amber-950/85 px-3 py-1.5 text-center text-xs leading-4 text-amber-100 backdrop-blur sm:right-4 sm:top-4">
                  Synthetic engineering fixture · edit pipeline only
                </div>
              )}
              {cutMode === 'better' && (
                <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full border border-primary/25 bg-[#15200f]/90 px-3 py-1.5 text-xs text-primary">
                  <Zap className="h-3.5 w-3.5" /> Edit preview active
                </div>
              )}
            </div>
            {sourceMode === 'acau' && (
              <div className="flex flex-col gap-3 border-t border-white/8 bg-[#0b0e0f] px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-primary/25 bg-primary/8 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary">
                      Real YouTube case
                    </span>
                    <span className="text-white/80">100 measured points</span>
                  </div>
                  <p className="mt-1 truncate text-muted-foreground">
                    {ACAU_CASE.subtitle} · {ACAU_CASE.channel}
                  </p>
                </div>
                <div className="flex shrink-0 gap-3">
                  <a
                    href={ACAU_CASE.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-white/70 transition hover:text-white"
                  >
                    YouTube <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={ACAU_CASE.datasetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary transition hover:text-primary/80"
                  >
                    Official data <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
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
                  selectSignal(signal);
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
              {sourceMode === 'acau' ? (
                <>
                  Curve-only analysis from ACAU&apos;s official open dataset (
                  {ACAU_CASE.analyticsPeriod}). No transcript or automated scene
                  evidence is claimed for this public case.
                </>
              ) : (
                <>
                  Curve-only analysis active. Add a timestamped transcript to
                  ground each signal in the spoken content.
                </>
              )}
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
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-[#79c6ff]/20 bg-[#79c6ff]/7 px-2.5 py-1 text-[#8ed0ff]">
              {contentProfileLabel(profile)} policy
            </span>
            <span className="rounded-full border border-white/10 bg-white/[.035] px-2.5 py-1 text-white/65">
              {momentLabel(selected.momentRole)} moment
            </span>
            <span className="rounded-full border border-white/10 bg-white/[.035] px-2.5 py-1 font-mono text-white/65">
              adaptive gate ±{selected.threshold.toFixed(1)} pts
            </span>
          </div>
          <div
            className="mt-5 grid grid-cols-3 gap-2"
            aria-label="Aligned evidence"
          >
            {evidence.map((item) => (
              <EvidenceCue key={item.label} {...item} />
            ))}
          </div>
          <div className="my-6 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
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
            <Metric
              label="Confidence"
              value={`${Math.round(selected.confidence * 100)}%`}
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
                {sourceMode === 'acau' ? (
                  <Button
                    className="flex-1"
                    onClick={() => previewAt(selected.time)}
                  >
                    <Play /> Open at {formatTime(selected.time)}
                  </Button>
                ) : (
                  <Button className="flex-1" onClick={makeRepair}>
                    {status === 'repaired' ? <Check /> : <Scissors />}
                    {status === 'repaired'
                      ? 'Better cut ready'
                      : 'Create better cut'}
                  </Button>
                )}
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
              {sourceMode === 'acau' && (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Recommendation only. Upload a rights-cleared source file to
                  preview, export, or render this edit.
                </p>
              )}
              <div className="mt-4 border-t border-white/8 pt-3">
                <p className="text-[10px] uppercase tracking-wider text-white/40">
                  Does this recommendation fit?
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-pressed={selectedFeedback?.verdict === 'accepted'}
                    onClick={() => recordRecommendationFeedback('accepted')}
                    className={
                      selectedFeedback?.verdict === 'accepted'
                        ? 'border-primary/35 bg-primary/10 text-primary'
                        : 'border-white/10 bg-white/[.025]'
                    }
                  >
                    <ThumbsUp /> Useful
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-pressed={selectedFeedback?.verdict === 'rejected'}
                    onClick={() => recordRecommendationFeedback('rejected')}
                    className={
                      selectedFeedback?.verdict === 'rejected'
                        ? 'border-[#ff7d69]/35 bg-[#ff7d69]/8 text-[#ff9b89]'
                        : 'border-white/10 bg-white/[.025]'
                    }
                  >
                    <ThumbsDown /> Not right
                  </Button>
                </div>
                {selectedFeedback && (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Saved on this device. Future{' '}
                    {contentProfileLabel(profile).toLowerCase()} suggestions
                    will favor{' '}
                    {feedbackPreference(recommendationFeedback, profile) ===
                    'review-first'
                      ? 'review before automatic edits.'
                      : 'actionable edit tests.'}
                  </p>
                )}
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
                    {selected.repair.action === 'remove'
                      ? `The preview skips ${formatTime(selected.repair.start)}–${formatTime(selected.repair.end)}.`
                      : `The preview opens with a ${formatTime(selected.repair.end - selected.repair.start)} teaser, then plays the full source.`}{' '}
                    {sourceMode === 'synthetic'
                      ? selected.repair.action === 'remove'
                        ? 'Download the verified synthetic render or export its source-bound edit plan.'
                        : 'Export the source-bound edit plan to render this promotion locally.'
                      : 'Export the source-bound edit plan for deterministic local rendering.'}
                  </p>
                </div>
              </div>
              <EditComparison
                duration={duration}
                signal={selected}
                activeMode={cutMode}
                onSelect={selectCutMode}
              />
              {sourceMode === 'synthetic' &&
                selected.repair.action === 'remove' && (
                  <a
                    href="/demo/retentiondna-better-cut.mp4"
                    download="retentiondna-better-cut.mp4"
                    className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/80"
                  >
                    <Film className="h-4 w-4" /> Download synthetic render
                  </a>
                )}
              <Button
                variant="outline"
                className="mt-2 w-full border-primary/20 bg-primary/5 text-primary"
                onClick={downloadPlan}
                disabled={exportState === 'hashing'}
              >
                {exportState === 'hashing' ? (
                  <LoaderCircle className="animate-spin" />
                ) : exportState === 'done' ? (
                  <ShieldCheck />
                ) : (
                  <Download />
                )}{' '}
                {exportState === 'hashing'
                  ? 'Binding plan to source…'
                  : exportState === 'done'
                    ? 'Source-bound plan exported'
                    : 'Export source-bound plan'}
              </Button>
              {exportState === 'error' && (
                <p role="alert" className="mt-2 text-xs text-[#ff9b89]">
                  The source fingerprint could not be created. Re-select the
                  video and try again.
                </p>
              )}
              <p className="mt-3 text-[10px] uppercase tracking-wider text-white/40">
                Outcome validation
              </p>
              <label className="mt-2 flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm font-medium transition hover:border-primary/30 hover:bg-primary/5">
                <TrendingUp className="h-4 w-4" /> Compare published result
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  className="sr-only"
                  onChange={onOutcomeChange}
                />
              </label>
              {outcome && <OutcomeResult comparison={outcome} />}
              {outcomeError && (
                <p role="alert" className="mt-2 text-xs text-[#ff9b89]">
                  {outcomeError}
                </p>
              )}
            </div>
          )}
          <div className="mt-8 border-t border-white/8 pt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Signals analyzed</span>
              <span className="font-mono">{signals.length}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Evidence coverage</span>
              <span className="font-mono text-primary">
                {
                  evidence.filter((item) => item.status !== 'unavailable')
                    .length
                }
                /{evidence.length} grounded
              </span>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-white/8 bg-card p-4">
            <div className="flex items-start gap-3">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-[#8ed0ff]" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">Creator DNA</p>
                  <span className="rounded-full bg-[#79c6ff]/10 px-2 py-0.5 font-mono text-[10px] text-[#8ed0ff]">
                    {creatorMemory.length} projects ·{' '}
                    {recommendationFeedback.length}{' '}
                    {recommendationFeedback.length === 1 ? 'rating' : 'ratings'}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {creatorInsight}
                </p>
                <p className="mt-2 text-[10px] uppercase tracking-wider text-white/35">
                  Summaries stay on this device · no video or transcript stored
                </p>
              </div>
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
function EvidenceCue({ label, value, basis, kind, status }: EvidenceCueData) {
  const Icon =
    kind === 'audio'
      ? AudioLines
      : kind === 'visual'
        ? ScanLine
        : kind === 'transcript'
          ? BadgeCheck
          : Activity;
  return (
    <div className="rounded-lg border border-white/8 bg-white/[.025] p-3">
      <div className="flex items-center justify-between gap-1">
        <Icon
          className={`h-4 w-4 ${status === 'unavailable' ? 'text-white/30' : 'text-primary'}`}
        />
        <span
          className={`h-1.5 w-1.5 rounded-full ${status === 'unavailable' ? 'bg-white/20' : status === 'aligned' ? 'bg-[#79c6ff]' : 'bg-primary'}`}
          aria-label={status}
        />
      </div>
      <p className="mt-2 text-xs font-medium leading-4 text-white/85">
        {value}
      </p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label} · {status}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-white/35">{basis}</p>
    </div>
  );
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

function EditComparison({
  duration,
  signal,
  activeMode,
  onSelect,
}: {
  duration: number;
  signal: RetentionSignal;
  activeMode: CutMode;
  onSelect: (mode: CutMode) => void;
}) {
  const editDuration = signal.repair.end - signal.repair.start;
  const projectedDuration =
    signal.repair.action === 'remove'
      ? duration - editDuration
      : duration + editDuration;
  const left = Math.max(
    0,
    Math.min(100, (signal.repair.start / duration) * 100),
  );
  const width = Math.max(
    1.5,
    Math.min(100 - left, (editDuration / duration) * 100),
  );
  return (
    <div className="mt-3 rounded-lg border border-white/8 bg-black/15 p-3">
      <div className="grid grid-cols-2 gap-2">
        {(['original', 'better'] as const).map((mode) => {
          const isActive = activeMode === mode;
          const modeDuration =
            mode === 'original' ? duration : projectedDuration;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onSelect(mode)}
              className={`rounded-lg border px-3 py-2 text-left transition ${isActive ? 'border-primary/35 bg-primary/8' : 'border-white/8 bg-white/[.025] hover:border-white/20'}`}
            >
              <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                {mode === 'original' ? 'Before' : 'After preview'}
              </span>
              <span className="mt-1 block font-mono text-sm">
                {formatTime(modeDuration)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className={`absolute inset-y-0 rounded-full ${signal.repair.action === 'remove' ? 'bg-[#ff7d69]' : 'bg-[#79c6ff]'}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {signal.repair.action === 'remove'
            ? 'Removed window'
            : 'Promoted teaser'}
        </span>
        <span className="font-mono text-white/60">
          {signal.repair.action === 'remove' ? '−' : '+'}
          {editDuration.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}

function OutcomeResult({ comparison }: { comparison: OutcomeComparison }) {
  const improved = comparison.change > 0;
  return (
    <div className="mt-3 rounded-lg border border-[#79c6ff]/20 bg-[#79c6ff]/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium">Observed result at this moment</p>
          <p className="mt-1 max-w-[220px] truncate text-[10px] text-muted-foreground">
            {comparison.fileName}
          </p>
        </div>
        <span
          className={`font-mono text-sm ${improved ? 'text-primary' : comparison.change < 0 ? 'text-[#ff9b89]' : 'text-white/60'}`}
        >
          {comparison.change > 0 ? '+' : ''}
          {comparison.change.toFixed(1)} pts
        </span>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
        Before {comparison.before.toFixed(1)}% · after{' '}
        {comparison.after.toFixed(1)}%. This is an observed comparison, not
        proof that the edit caused the change.
      </p>
    </div>
  );
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function retentionAt(points: RetentionPoint[], time: number): number {
  if (!points.length) return 0;
  if (time <= points[0].time) return points[0].retention;
  const nextIndex = points.findIndex((point) => point.time >= time);
  if (nextIndex < 0) return points.at(-1)!.retention;
  const next = points[nextIndex];
  const previous = points[nextIndex - 1];
  const span = next.time - previous.time;
  if (span <= 0) return next.retention;
  const progress = (time - previous.time) / span;
  return previous.retention + (next.retention - previous.retention) * progress;
}

function parseCreatorMemory(text: string): CreatorMemoryEntry[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is CreatorMemoryEntry => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<CreatorMemoryEntry>;
      return (
        typeof candidate.sourceName === 'string' &&
        typeof candidate.analyzedAt === 'string' &&
        typeof candidate.duration === 'number' &&
        Number.isFinite(candidate.duration) &&
        (candidate.strongestType === 'dip' ||
          candidate.strongestType === 'spike') &&
        typeof candidate.strongestTime === 'number' &&
        Number.isFinite(candidate.strongestTime) &&
        typeof candidate.strongestDelta === 'number' &&
        Number.isFinite(candidate.strongestDelta) &&
        (candidate.profile === undefined || isContentProfile(candidate.profile))
      );
    })
    .slice(0, 12);
}

function parseRecommendationFeedback(text: string): RecommendationFeedback[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is RecommendationFeedback => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<RecommendationFeedback>;
      return (
        typeof candidate.key === 'string' &&
        isContentProfile(candidate.profile) &&
        (candidate.verdict === 'accepted' ||
          candidate.verdict === 'rejected') &&
        typeof candidate.recordedAt === 'string'
      );
    })
    .slice(0, 60);
}

function feedbackPreference(
  entries: RecommendationFeedback[],
  profile: ContentProfile,
): FeedbackPreference {
  const matching = entries.filter((entry) => entry.profile === profile);
  if (!matching.length) return 'neutral';
  const accepted = matching.filter(
    (entry) => entry.verdict === 'accepted',
  ).length;
  return accepted >= matching.length - accepted
    ? 'edit-friendly'
    : 'review-first';
}

function summarizeCreatorMemory(
  entries: CreatorMemoryEntry[],
  feedback: RecommendationFeedback[],
): string {
  if (!entries.length && !feedback.length)
    return 'Analyze real projects and rate recommendations to build a private, format-aware editing pattern.';
  const reviewFirstProfiles = CONTENT_PROFILES.filter(
    ({ value }) => feedbackPreference(feedback, value) === 'review-first',
  ).map(({ label }) => label.toLowerCase());
  if (!entries.length && reviewFirstProfiles.length)
    return `Your feedback favors review-first suggestions for ${reviewFirstProfiles.join(', ')} content.`;
  const earlyLosses = entries.filter(
    (entry) =>
      entry.strongestType === 'dip' &&
      entry.strongestTime <= Math.max(6, entry.duration * 0.35),
  ).length;
  const replayWins = entries.filter(
    (entry) => entry.strongestType === 'spike',
  ).length;
  const leadingProfile = entries.reduce<ContentProfile | undefined>(
    (best, entry) => best ?? entry.profile,
    undefined,
  );
  const formatContext = leadingProfile
    ? ` across ${contentProfileLabel(leadingProfile).toLowerCase()} projects`
    : '';
  if (earlyLosses > replayWins)
    return `${earlyLosses} of ${entries.length} projects${formatContext} show their strongest loss early. Test faster proof before adding more context.`;
  if (replayWins)
    return `${replayWins} of ${entries.length} projects${formatContext} contain a dominant replay moment worth testing as an opening teaser.`;
  return `${entries.length} projects observed. Add more uploads before treating any pattern as recurring.`;
}

function isContentProfile(value: unknown): value is ContentProfile {
  return CONTENT_PROFILES.some((profile) => profile.value === value);
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
