export type RetentionPoint = {
  time: number;
  retention: number;
};

export type EditAction = 'remove' | 'promote';

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
      'elapsed',
    ].includes(header),
  );
  const retentionIndex = headers.findIndex((header) =>
    [
      'retention',
      'audiencewatchratio',
      'audience retention',
      'watch ratio',
    ].includes(header),
  );

  if (timeIndex < 0 || retentionIndex < 0) {
    throw new Error(
      'Use columns named time/timestamp and retention/audienceWatchRatio.',
    );
  }

  const timeHeader = headers[timeIndex];
  const retentionHeader = headers[retentionIndex];
  const normalizedTime = ['elapsedvideotimeratio', 'elapsed ratio'].includes(
    timeHeader,
  );
  const ratioRetention = ['audiencewatchratio', 'watch ratio'].includes(
    retentionHeader,
  );

  const raw = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return {
      time: parseTime(cells[timeIndex]?.trim() ?? '', normalizedTime),
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
      time: normalizedTime ? point.time * (duration ?? 0) : point.time,
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
): RetentionSignal[] {
  if (points.length < 4) return [];
  const candidates: RetentionSignal[] = [];
  const videoDuration = Math.max(points.at(-1)!.time, 0.1);
  const measuredDuration = Math.max(0, videoDuration - points[0].time);
  const maximumRepairDuration = Math.max(2, measuredDuration * 0.3);

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
    const delta = Number((after - before).toFixed(1));

    if (delta <= -7)
      candidates.push(
        makeSignal(
          'dip',
          points[index],
          points[index + 1],
          delta,
          maximumRepairDuration,
          videoDuration,
        ),
      );
    if (delta >= 7)
      candidates.push(
        makeSignal(
          'spike',
          points[index],
          points[index + 1],
          delta,
          maximumRepairDuration,
          videoDuration,
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
): RetentionSignal {
  const severity = Math.abs(delta) >= 13 ? 'high' : 'medium';
  const confidence = Math.min(0.97, 0.55 + Math.abs(delta) / 50);
  const window = Math.max(6, Math.min(18, next.time - point.time + 8));
  const end = Math.min(videoDuration, point.time + 3);
  const start = Math.max(0, point.time - window, end - maximumRepairDuration);

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
      title: 'Viewers replayed this moment',
      explanation:
        'A sharp rise suggests this section was especially valuable—or needed a second listen to understand.',
      learnedRule:
        'Introduce this payoff earlier, while preserving the context that makes it useful.',
      repair: {
        label: 'Promote the payoff',
        start: point.time,
        end: Math.min(
          videoDuration,
          point.time + maximumTeaserDuration,
          next.time + 4,
        ),
        action: 'promote',
        description: 'Create a short opening teaser from the replayed moment.',
      },
    };
  }

  const earlyBoundary = Math.min(60, Math.max(6, videoDuration * 0.35));
  const isEarly = point.time <= earlyBoundary;
  const payoffTarget = Math.min(
    videoDuration,
    Math.max(2, Math.min(20, Math.round(videoDuration * 0.2))),
  );

  return {
    id: `dip-${Math.round(point.time)}`,
    type,
    time: point.time,
    endTime: next.time,
    delta,
    retention: point.retention,
    severity,
    confidence,
    title: isEarly ? 'Early viewer loss' : 'Momentum breaks here',
    explanation: isEarly
      ? 'Viewer loss accelerates early in this video. Review the surrounding promise, pacing, and setup before assigning a cause.'
      : 'Viewer loss accelerates inside this section. Review the surrounding explanation for repetition, silence, or an abrupt topic shift.',
    learnedRule: isEarly
      ? `Test the first concrete payoff by ${formatTime(payoffTarget)}, then compare the next retention curve.`
      : 'Keep each explanation moving toward a visible payoff and remove repeated setup.',
    repair: {
      label: 'Tighten this section',
      start,
      end,
      action: 'remove',
      description: `Remove the slowest ${Math.round(end - start)} seconds before the detected drop.`,
    },
  };
}

function parseTime(value: string, normalized: boolean): number {
  if (/^\d+(?::\d{1,2}){1,2}$/.test(value)) {
    return value
      .split(':')
      .reduce((total, part) => total * 60 + Number(part), 0);
  }
  const cleaned = value.trim();
  const parsed = Number(cleaned.replace('%', ''));
  return normalized && cleaned.endsWith('%') ? parsed / 100 : parsed;
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
