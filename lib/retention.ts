export type RetentionPoint = {
  time: number;
  retention: number;
};

export type RetentionSignal = {
  id: string;
  type: 'dip' | 'spike';
  time: number;
  endTime: number;
  delta: number;
  retention: number;
  severity: 'high' | 'medium';
  title: string;
  explanation: string;
  learnedRule: string;
  repair: {
    label: string;
    start: number;
    end: number;
    action: 'remove' | 'promote';
    description: string;
  };
};

export const SAMPLE_RETENTION: RetentionPoint[] = [
  100, 98, 96, 93, 89, 70, 51, 47, 45, 48, 52, 49, 46, 43, 40, 52, 58, 52,
  47, 43, 40,
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

  const raw = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return {
      time: parseTime(cells[timeIndex]?.trim() ?? ''),
      retention: parseRatio(cells[retentionIndex]?.trim() ?? ''),
    };
  });

  if (
    raw.some(
      (point) =>
        !Number.isFinite(point.time) || !Number.isFinite(point.retention),
    )
  ) {
    throw new Error(
      'Some rows contain an invalid timestamp or retention value.',
    );
  }

  const looksNormalized =
    raw.at(-1)!.time <= 1 &&
    raw.some((point) => point.time > 0 && point.time < 1);
  if (looksNormalized && !duration) {
    throw new Error(
      'Normalized elapsedVideoTimeRatio data needs a video so timestamps can be calculated.',
    );
  }

  return raw
    .map((point) => ({
      time: looksNormalized ? point.time * (duration ?? 0) : point.time,
      retention:
        point.retention <= 1.5 ? point.retention * 100 : point.retention,
    }))
    .sort((a, b) => a.time - b.time);
}

export function detectRetentionSignals(
  points: RetentionPoint[],
): RetentionSignal[] {
  if (points.length < 4) return [];
  const candidates: RetentionSignal[] = [];

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
        makeSignal('dip', points[index], points[index + 1], delta),
      );
    if (delta >= 7)
      candidates.push(
        makeSignal('spike', points[index], points[index + 1], delta),
      );
  }

  return candidates
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .filter(
      (signal, index, all) =>
        all.findIndex((other) => Math.abs(other.time - signal.time) < 10) ===
        index,
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
  sourceName: string,
) {
  return {
    schema: 'retentiondna.edit-plan.v1',
    source: sourceName,
    generatedAt: new Date().toISOString(),
    evidence: {
      signal: signal.type,
      timestamp: signal.time,
      retention: signal.retention,
      delta: signal.delta,
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
): RetentionSignal {
  const severity = Math.abs(delta) >= 13 ? 'high' : 'medium';
  const window = Math.max(6, Math.min(18, next.time - point.time + 8));
  const start = Math.max(0, point.time - window);
  const end = point.time + 3;

  if (type === 'spike') {
    return {
      id: `spike-${Math.round(point.time)}`,
      type,
      time: point.time,
      endTime: next.time,
      delta,
      retention: point.retention,
      severity,
      title: 'Viewers replayed this moment',
      explanation:
        'A sharp rise suggests this section was especially valuable—or needed a second listen to understand.',
      learnedRule:
        'Introduce this payoff earlier, while preserving the context that makes it useful.',
      repair: {
        label: 'Promote the payoff',
        start: point.time,
        end: Math.min(point.time + 8, next.time + 4),
        action: 'promote',
        description: 'Create a short opening teaser from the replayed moment.',
      },
    };
  }

  return {
    id: `dip-${Math.round(point.time)}`,
    type,
    time: point.time,
    endTime: next.time,
    delta,
    retention: point.retention,
    severity,
    title:
      point.time < 60 ? 'The value arrives too late' : 'Momentum breaks here',
    explanation:
      point.time < 60
        ? 'Viewer loss accelerates before the first minute, which usually indicates delayed value, repeated setup, or a promise mismatch.'
        : 'Viewer loss accelerates inside this section. Review the surrounding explanation for repetition, silence, or an abrupt topic shift.',
    learnedRule:
      point.time < 60
        ? 'Deliver the first concrete payoff within 20 seconds and move personal context after it.'
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

function parseTime(value: string): number {
  if (/^\d+(?::\d{1,2}){1,2}$/.test(value)) {
    return value
      .split(':')
      .reduce((total, part) => total * 60 + Number(part), 0);
  }
  return Number(value.replace('%', ''));
}

function parseRatio(value: string): number {
  return Number(value.replace('%', '').trim());
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
