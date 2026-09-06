export type RetentionPoint = {
  time: number;
  retention: number;
};

export type EditAction = 'remove' | 'promote';

export type ContentProfile =
  | 'general'
  | 'tutorial'
  | 'documentary'
  | 'podcast'
  | 'short'
  | 'gaming'
  | 'music';

export type MomentRole =
  | 'hook'
  | 'setup'
  | 'explanation'
  | 'demonstration'
  | 'payoff'
  | 'transition'
  | 'discussion'
  | 'gameplay'
  | 'performance';

export type FeedbackPreference = 'neutral' | 'edit-friendly' | 'review-first';

export type TimedText = { time: number; end: number; text: string };

export const CONTENT_PROFILES: ReadonlyArray<{
  value: ContentProfile;
  label: string;
}> = [
  { value: 'general', label: 'General' },
  { value: 'tutorial', label: 'Tutorial' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'podcast', label: 'Podcast / interview' },
  { value: 'short', label: 'Short-form' },
  { value: 'gaming', label: 'Gaming' },
  { value: 'music', label: 'Music / performance' },
];

export type SourceIdentity = {
  name: string;
  sizeBytes: number;
  durationSeconds: number;
  sha256: string;
};

export type RetentionSignal = {
  id: string;
  type: 'dip' | 'spike';
  time: number;
  endTime: number;
  delta: number;
  retention: number;
  severity: 'high' | 'medium';
  confidence: number;
  profile: ContentProfile;
  momentRole: MomentRole;
  threshold: number;
  title: string;
  explanation: string;
  learnedRule: string;
  repair: {
    label: string;
    start: number;
    end: number;
    action: EditAction;
    description: string;
  };
};

export const SAMPLE_RETENTION: RetentionPoint[] = [
  100, 98, 96, 93, 89, 70, 51, 47, 45, 48, 52, 49, 46, 43, 40, 52, 58, 52, 47,
  43, 40,
].map((retention, index) => ({ time: index * 5, retention }));

export function parseRetentionCsv(
  csv: string,
  duration?: number,
): RetentionPoint[] {
  const lines = csv.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 3)
    throw new Error('Retention CSV needs a header and at least two data rows.');

  const headers = splitCsvLine(lines[0]).map((value) =>
    value.trim().toLowerCase(),
  );
  const timeIndex = headers.findIndex((header) =>
    [
      'time',
      'timestamp',
      'elapsedvideotimeratio',
      'elapsed ratio',
      'position_ratio',
      'position_percentage',
      'position_seconds',
      'elapsed',
    ].includes(header),
  );
  const retentionIndex = headers.findIndex((header) =>
    [
      'retention',
      'audiencewatchratio',
      'audience_ratio',
      'audience_percentage',
      'audience retention',
      'watch ratio',
    ].includes(header),
  );

  if (timeIndex < 0 || retentionIndex < 0) {
    throw new Error(
      'Use time/timestamp, YouTube Analytics, or ACAU position and audience columns.',
    );
  }

  const timeHeader = headers[timeIndex];
  const retentionHeader = headers[retentionIndex];
  const normalizedTime = [
    'elapsedvideotimeratio',
    'elapsed ratio',
    'position_ratio',
    'position_percentage',
  ].includes(timeHeader);
  const percentageTime = timeHeader === 'position_percentage';
  const ratioRetention = [
    'audiencewatchratio',
    'watch ratio',
    'audience_ratio',
  ].includes(retentionHeader);

  const raw = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return {
      time: parseTime(
        cells[timeIndex]?.trim() ?? '',
        normalizedTime,
        percentageTime,
      ),
      retention: parseRetentionValue(
        cells[retentionIndex]?.trim() ?? '',
        ratioRetention,
      ),
    };
  });

  if (
    raw.some(
      (point) =>
        !Number.isFinite(point.time) ||
        !Number.isFinite(point.retention) ||
        point.time < 0 ||
        point.retention < 0,
    )
  ) {
    throw new Error(
      'Timestamps and retention values must be finite, non-negative numbers.',
    );
  }

  if (normalizedTime && !duration) {
    throw new Error(
      'Normalized elapsedVideoTimeRatio data needs a video so timestamps can be calculated.',
    );
  }

  const points = raw
    .map((point) => ({
      time: normalizedTime
        ? Number((point.time * (duration ?? 0)).toFixed(6))
        : point.time,
      retention: point.retention,
    }))
    .sort((a, b) => a.time - b.time);
  if (
    points.some(
      (point, index) => index > 0 && point.time <= points[index - 1].time,
    )
  ) {
    throw new Error('Retention timestamps must be strictly increasing.');
  }
  if (duration && points.at(-1)!.time > duration + 0.1) {
    throw new Error('Retention timestamps exceed the selected video duration.');
  }
  return points;
}

export function parseRetentionInput(
  text: string,
  fileName: string,
  duration: number,
): RetentionPoint[] {
  if (
    fileName.toLowerCase().endsWith('.json') ||
    text.trimStart().startsWith('{')
  )
    return parseYouTubeAnalyticsReport(text, duration);
  return parseRetentionCsv(text, duration);
}

export function parseYouTubeAnalyticsReport(
  text: string,
  duration: number,
): RetentionPoint[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('YouTube Analytics JSON could not be parsed.');
  }
  if (!payload || typeof payload !== 'object')
    throw new Error('YouTube Analytics report must be an object.');
  const report = payload as { columnHeaders?: unknown; rows?: unknown };
  if (!Array.isArray(report.columnHeaders) || !Array.isArray(report.rows))
    throw new Error('YouTube Analytics JSON needs columnHeaders and rows.');
  const names = report.columnHeaders.map((item) =>
    item && typeof item === 'object' && 'name' in item
      ? String((item as { name: unknown }).name)
      : '',
  );
  const elapsedIndex = names.indexOf('elapsedVideoTimeRatio');
  const watchIndex = names.indexOf('audienceWatchRatio');
  if (elapsedIndex < 0 || watchIndex < 0)
    throw new Error(
      'YouTube Analytics JSON needs elapsedVideoTimeRatio and audienceWatchRatio.',
    );
  if (report.rows.length < 2)
    throw new Error(
      'YouTube Analytics report needs at least two retention rows.',
    );
  const points = report.rows.map((row, index) => {
    if (!Array.isArray(row))
      throw new Error(`YouTube Analytics row ${index + 1} must be an array.`);
    const elapsed = Number(row[elapsedIndex]);
    const watch = Number(row[watchIndex]);
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 1)
      throw new Error(
        `YouTube Analytics row ${index + 1} has an invalid elapsed ratio.`,
      );
    if (!Number.isFinite(watch) || watch < 0)
      throw new Error(
        `YouTube Analytics row ${index + 1} has an invalid watch ratio.`,
      );
    return { time: elapsed * duration, retention: watch * 100 };
  });
  points.sort((a, b) => a.time - b.time);
  if (
    points.some(
      (point, index) => index > 0 && point.time <= points[index - 1].time,
    )
  )
    throw new Error('YouTube Analytics elapsed ratios must be unique.');
  return points;
}

export function detectRetentionSignals(
  points: RetentionPoint[],
  options: {
    profile?: ContentProfile;
    transcript?: TimedText[];
    feedbackPreference?: FeedbackPreference;
  } = {},
): RetentionSignal[] {
  if (points.length < 4) return [];
  const candidates: RetentionSignal[] = [];
  const videoDuration = Math.max(points.at(-1)!.time, 0.1);
  const measuredDuration = Math.max(0, videoDuration - points[0].time);
  const maximumRepairDuration = Math.max(2, measuredDuration * 0.3);
  const profile = options.profile ?? 'general';
  const deltas = windowedDeltas(points);
  const threshold = adaptiveSignalThreshold(points, profile);

  for (const { index, delta } of deltas) {
    if (delta <= -threshold)
      candidates.push(
        makeSignal(
          'dip',
          points[index],
          points[index + 1],
          delta,
          maximumRepairDuration,
          videoDuration,
          profile,
          options.transcript ?? [],
          threshold,
          options.feedbackPreference ?? 'neutral',
        ),
      );
    if (delta >= threshold)
      candidates.push(
        makeSignal(
          'spike',
          points[index],
          points[index + 1],
          delta,
          maximumRepairDuration,
          videoDuration,
          profile,
          options.transcript ?? [],
          threshold,
          options.feedbackPreference ?? 'neutral',
        ),
      );
  }

  const dedupeWindow = Math.max(2, Math.min(10, videoDuration * 0.08));
  return candidates
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .filter(
      (signal, index, all) =>
        all.findIndex(
          (other) => Math.abs(other.time - signal.time) < dedupeWindow,
        ) === index,
    )
    .slice(0, 6)
    .sort((a, b) => a.time - b.time);
}

export function adaptiveSignalThreshold(
  points: RetentionPoint[],
  profile: ContentProfile = 'general',
): number {
  const magnitudes = windowedDeltas(points).map(({ delta }) => Math.abs(delta));
  if (!magnitudes.length) return profileThresholdFloor(profile);
  const center = median(magnitudes);
  const deviation = median(
    magnitudes.map((magnitude) => Math.abs(magnitude - center)),
  );
  return Number(
    Math.max(
      profileThresholdFloor(profile),
      Math.min(10, center + deviation * 1.5),
    ).toFixed(1),
  );
}

export function inferContentProfile({
  sourceName,
  duration,
  transcript = [],
}: {
  sourceName: string;
  duration: number;
  transcript?: TimedText[];
}): ContentProfile {
  const corpus =
    `${sourceName} ${transcript.map((line) => line.text).join(' ')}`.toLowerCase();
  if (duration <= 75 || /\b(shorts?|reel|tiktok|vertical)\b/.test(corpus))
    return 'short';
  if (/\b(tutorial|how to|step by step|workflow|guide|lesson)\b/.test(corpus))
    return 'tutorial';
  if (/\b(documentary|documental|cine|film|history|episode)\b/.test(corpus))
    return 'documentary';
  if (/\b(podcast|interview|conversation|roundtable)\b/.test(corpus))
    return 'podcast';
  if (/\b(gameplay|gaming|walkthrough|boss|match|speedrun)\b/.test(corpus))
    return 'gaming';
  if (/\b(song|music|official audio|lyrics|performance|concert)\b/.test(corpus))
    return 'music';
  return 'general';
}

export function classifyMoment(
  time: number,
  duration: number,
  profile: ContentProfile,
  transcript: TimedText[] = [],
): MomentRole {
  const nearby = transcript
    .filter((line) => line.end >= time - 12 && line.time <= time + 8)
    .map((line) => line.text)
    .join(' ')
    .toLowerCase();
  const progress = time / Math.max(duration, 0.1);
  if (
    /\b(result|payoff|finally|reveal|answer|finished|before and after)\b/.test(
      nearby,
    )
  )
    return 'payoff';
  if (/\b(step|click|open|choose|add|build|create|show you)\b/.test(nearby))
    return 'demonstration';
  if (/\b(because|means|explain|context|reason|understand)\b/.test(nearby))
    return 'explanation';
  if (/\b(next|meanwhile|however|moving on|chapter)\b/.test(nearby))
    return 'transition';
  if (progress <= 0.08) return 'hook';
  if (progress <= 0.2) return 'setup';
  if (profile === 'podcast') return 'discussion';
  if (profile === 'gaming') return 'gameplay';
  if (profile === 'music') return 'performance';
  if (profile === 'tutorial') return 'demonstration';
  return progress >= 0.75 ? 'payoff' : 'transition';
}

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function createEditDecisionList(
  signal: RetentionSignal,
  source: SourceIdentity,
) {
  return {
    schema: 'retentiondna.edit-plan.v2',
    source,
    generatedAt: new Date().toISOString(),
    evidence: {
      signal: signal.type,
      timestamp: signal.time,
      retention: signal.retention,
      delta: signal.delta,
      confidence: signal.confidence,
      contentProfile: signal.profile,
      momentRole: signal.momentRole,
      adaptiveThreshold: signal.threshold,
      explanation: signal.explanation,
    },
    operations: [
      {
        action: signal.repair.action,
        start: signal.repair.start,
        end: signal.repair.end,
        reason: signal.repair.description,
      },
    ],
    disclaimer:
      'This edit is evidence-informed. It does not guarantee future audience retention.',
  };
}

function makeSignal(
  type: 'dip' | 'spike',
  point: RetentionPoint,
  next: RetentionPoint,
  delta: number,
  maximumRepairDuration = Number.POSITIVE_INFINITY,
  videoDuration = next.time,
  profile: ContentProfile = 'general',
  transcript: TimedText[] = [],
  threshold = 7,
  feedbackPreference: FeedbackPreference = 'neutral',
): RetentionSignal {
  const severity = Math.abs(delta) >= 13 ? 'high' : 'medium';
  const confidence = Math.min(
    0.98,
    0.58 + Math.min(0.4, (Math.abs(delta) / threshold) * 0.14),
  );
  const profileWindow = profile === 'short' ? 4 : profile === 'music' ? 10 : 18;
  const window = Math.max(
    profile === 'short' ? 1.5 : 6,
    Math.min(profileWindow, next.time - point.time + 8),
  );
  const end = Math.min(videoDuration, point.time + 3);
  const start = Math.max(0, point.time - window, end - maximumRepairDuration);
  const momentRole = classifyMoment(
    point.time,
    videoDuration,
    profile,
    transcript,
  );

  if (type === 'spike') {
    const maximumTeaserDuration = Math.min(
      8,
      Math.max(1, videoDuration * 0.15),
    );
    return {
      id: `spike-${Math.round(point.time)}`,
      type,
      time: point.time,
      endTime: next.time,
      delta,
      retention: point.retention,
      severity,
      confidence,
      profile,
      momentRole,
      threshold,
      title: profileCopy(profile, 'spike', momentRole).title,
      explanation: profileCopy(profile, 'spike', momentRole).explanation,
      learnedRule: profileCopy(profile, 'spike', momentRole).rule,
      repair: {
        label:
          feedbackPreference === 'review-first'
            ? 'Review this replay first'
            : 'Promote the payoff',
        start: point.time,
        end: Math.min(
          videoDuration,
          point.time + maximumTeaserDuration,
          next.time + 4,
        ),
        action: 'promote',
        description:
          feedbackPreference === 'review-first'
            ? 'Your feedback favors review-first suggestions. Inspect why viewers replayed this moment before promoting it.'
            : profileCopy(profile, 'spike', momentRole).repair,
      },
    };
  }

  const earlyBoundary = Math.min(60, Math.max(6, videoDuration * 0.35));
  const isEarly = point.time <= earlyBoundary;
  const payoffTarget = Math.min(
    videoDuration,
    Math.max(2, Math.min(20, Math.round(videoDuration * 0.2))),
  );
  const copy = profileCopy(profile, 'dip', momentRole);

  return {
    id: `dip-${Math.round(point.time)}`,
    type,
    time: point.time,
    endTime: next.time,
    delta,
    retention: point.retention,
    severity,
    confidence,
    profile,
    momentRole,
    threshold,
    title: isEarly ? copy.earlyTitle : copy.title,
    explanation: copy.explanation,
    learnedRule: isEarly
      ? `${copy.rule} Test the first concrete payoff by ${formatTime(payoffTarget)}.`
      : copy.rule,
    repair: {
      label:
        feedbackPreference === 'review-first'
          ? 'Review before trimming'
          : copy.label,
      start,
      end,
      action: 'remove',
      description:
        feedbackPreference === 'review-first'
          ? `Your feedback favors review-first suggestions. Inspect this ${momentLabel(momentRole).toLowerCase()} before testing a ${Math.round(end - start)}-second trim.`
          : `${copy.repair} Test a bounded ${Math.round(end - start)}-second trim before the measured drop.`,
    },
  };
}

type SpikeProfileCopy = {
  title: string;
  explanation: string;
  rule: string;
  repair: string;
};

type DipProfileCopy = SpikeProfileCopy & {
  earlyTitle: string;
  label: string;
};

function profileCopy(
  profile: ContentProfile,
  type: 'spike',
  role: MomentRole,
): SpikeProfileCopy;
function profileCopy(
  profile: ContentProfile,
  type: 'dip',
  role: MomentRole,
): DipProfileCopy;
function profileCopy(
  profile: ContentProfile,
  type: 'dip' | 'spike',
  role: MomentRole,
): SpikeProfileCopy | DipProfileCopy {
  const roleName = momentLabel(role).toLowerCase();
  if (type === 'spike') {
    const spikeCopy: Record<ContentProfile, SpikeProfileCopy> = {
      general: {
        title: 'Viewers replayed this moment',
        explanation: `A sharp rise around this ${roleName} suggests value or difficulty worth reviewing.`,
        rule: 'Introduce proven value earlier without removing the context that makes it useful.',
        repair: 'Create a short opening teaser from the replayed moment.',
      },
      tutorial: {
        title: 'A teaching moment earned replays',
        explanation: `Viewers returned to this ${roleName}, which may contain a useful step or a dense instruction.`,
        rule: 'Preview the result early, then slow down the instruction where viewers deliberately rewatch.',
        repair:
          'Tease this teaching payoff without duplicating the full explanation.',
      },
      documentary: {
        title: 'A narrative moment drew viewers back',
        explanation: `This ${roleName} may be especially revealing, emotional, or difficult to follow.`,
        rule: 'Foreshadow the moment while preserving the narrative context that gives it meaning.',
        repair:
          'Test a short contextual teaser rather than extracting the moment in isolation.',
      },
      podcast: {
        title: 'A quotable moment earned replays',
        explanation: `Listeners returned to this ${roleName}, suggesting a strong claim, insight, or unclear exchange.`,
        rule: 'Tease the strongest statement early and retain the conversation that supports it.',
        repair: 'Open with a concise quote from this replayed exchange.',
      },
      short: {
        title: 'A loop-worthy beat stands out',
        explanation: `This ${roleName} interrupts the normal short-form curve with a measurable replay lift.`,
        rule: 'Bring the strongest visual or verbal beat forward without weakening the loop.',
        repair: 'Test a one-to-three-second cold open from this beat.',
      },
      gaming: {
        title: 'A gameplay moment earned replays',
        explanation: `Viewers revisited this ${roleName}, possibly for a tactic, reaction, or high-skill play.`,
        rule: 'Tease the play early, then preserve the setup needed to understand it.',
        repair: 'Create a short cold open from the replayed play or reaction.',
      },
      music: {
        title: 'A performance moment earned replays',
        explanation: `Listeners returned to this ${roleName}, indicating a memorable section or transition.`,
        rule: 'Use the replayed section for discovery without disrupting the full performance arc.',
        repair:
          'Test a short preview clip; keep the original musical structure intact.',
      },
    };
    return spikeCopy[profile];
  }
  const dipCopy: Record<ContentProfile, DipProfileCopy> = {
    general: {
      earlyTitle: 'Early viewer loss',
      title: 'Momentum breaks here',
      explanation: `Viewer loss accelerates around this ${roleName}. Review pacing and promise alignment before assigning a cause.`,
      rule: 'Keep each section moving toward visible value and compare the next curve.',
      label: 'Tighten this section',
      repair:
        'Remove repeated setup or dead time only after reviewing the source.',
    },
    tutorial: {
      earlyTitle: 'The lesson loses viewers early',
      title: 'Learning momentum drops',
      explanation: `The curve falls around this ${roleName}; the step may be delayed, dense, or missing visible progress.`,
      rule: 'Show the result, prerequisite, or next visible step before adding more explanation.',
      label: 'Accelerate the teaching step',
      repair:
        'Shorten setup and move the next demonstration closer to the question it answers.',
    },
    documentary: {
      earlyTitle: 'The narrative loses viewers early',
      title: 'Narrative momentum drops',
      explanation: `The curve falls around this ${roleName}; the transition may need clearer stakes, orientation, or visual progression.`,
      rule: 'Clarify the narrative question while preserving context and emotional pacing.',
      label: 'Tighten the narrative transition',
      repair:
        'Shorten only redundant orientation; preserve essential story context.',
    },
    podcast: {
      earlyTitle: 'The conversation starts slowly',
      title: 'Conversation momentum drops',
      explanation: `Listener loss increases around this ${roleName}; repetition, a tangent, or delayed specificity may be responsible.`,
      rule: 'Reach a concrete claim faster and trim repetition without flattening the conversation.',
      label: 'Tighten the exchange',
      repair:
        'Remove repeated framing or dead air while preserving the speaker’s argument.',
    },
    short: {
      earlyTitle: 'The hook loses the swipe',
      title: 'The short loses momentum',
      explanation: `A sharp loss around this ${roleName} is large relative to the compressed short-form timeline.`,
      rule: 'Make the first frame legible and deliver a visual change or payoff every few seconds.',
      label: 'Compress this beat',
      repair: 'Test a one-to-four-second reduction without breaking the loop.',
    },
    gaming: {
      earlyTitle: 'The gameplay hook arrives late',
      title: 'Gameplay momentum drops',
      explanation: `Viewer loss rises around this ${roleName}; menus, travel, retries, or missing stakes may be slowing the sequence.`,
      rule: 'Keep the objective visible and compress downtime between meaningful decisions.',
      label: 'Trim gameplay downtime',
      repair: 'Shorten non-decision downtime while keeping strategic context.',
    },
    music: {
      earlyTitle: 'The performance opening loses listeners',
      title: 'Listening momentum drops',
      explanation: `Audience loss increases around this ${roleName}; confirm whether it is an intentional musical transition before editing.`,
      rule: 'Preserve musical structure; use retention as a review cue, not an automatic cut instruction.',
      label: 'Review the musical transition',
      repair:
        'Only test shortening non-performance material or clearly redundant framing.',
    },
  };
  return dipCopy[profile];
}

export function contentProfileLabel(profile: ContentProfile): string {
  return (
    CONTENT_PROFILES.find((item) => item.value === profile)?.label ?? 'General'
  );
}

export function momentLabel(role: MomentRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function windowedDeltas(points: RetentionPoint[]) {
  const deltas: Array<{ index: number; delta: number }> = [];
  for (let index = 2; index < points.length - 1; index += 1) {
    const before = average(
      points
        .slice(Math.max(0, index - 2), index)
        .map((point) => point.retention),
    );
    const after = average(
      points
        .slice(index, Math.min(points.length, index + 2))
        .map((point) => point.retention),
    );
    deltas.push({ index, delta: Number((after - before).toFixed(1)) });
  }
  return deltas;
}

function profileThresholdFloor(profile: ContentProfile): number {
  return {
    general: 6,
    tutorial: 6,
    documentary: 5.5,
    podcast: 5.5,
    short: 4,
    gaming: 6,
    music: 5,
  }[profile];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function parseTime(
  value: string,
  normalized: boolean,
  percentageHeader = false,
): number {
  if (/^\d+(?::\d{1,2}){1,2}$/.test(value)) {
    return value
      .split(':')
      .reduce((total, part) => total * 60 + Number(part), 0);
  }
  const cleaned = value.trim();
  const parsed = Number(cleaned.replace('%', ''));
  return normalized && (cleaned.endsWith('%') || percentageHeader)
    ? parsed / 100
    : parsed;
}

function parseRetentionValue(value: string, ratioHeader: boolean): number {
  const cleaned = value.trim();
  const explicitPercent = cleaned.endsWith('%');
  const parsed = Number(cleaned.replace('%', ''));
  if (explicitPercent) return parsed;
  if (ratioHeader) return parsed * 100;
  return parsed <= 1.5 ? parsed * 100 : parsed;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells;
}

function average(values: number[]): number {
  return (
    values.reduce((total, value) => total + value, 0) /
    Math.max(values.length, 1)
  );
}
