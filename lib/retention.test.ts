import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createEditDecisionList,
  detectRetentionSignals,
  parseRetentionCsv,
  parseYouTubeAnalyticsReport,
  type SourceIdentity,
} from './retention.ts';
import { ACAU_CASE } from './acau-case.ts';
import { initialWorkflowState, workflowReducer } from './workflow.ts';

type GoldenCase = {
  name: string;
  duration: number;
  csv: string;
  times: number[];
  retention: number[];
};

const goldenCases = JSON.parse(
  readFileSync(
    new URL('../fixtures/golden-retention-cases.json', import.meta.url),
    'utf8',
  ),
) as GoldenCase[];

for (const fixture of goldenCases) {
  void test(`golden parser: ${fixture.name}`, () => {
    const points = parseRetentionCsv(fixture.csv, fixture.duration);
    assert.deepEqual(
      points.map((point) => point.time),
      fixture.times,
    );
    assert.deepEqual(
      points.map((point) => point.retention),
      fixture.retention,
    );
  });
}

void test('public ACAU case preserves the complete published curve', () => {
  assert.equal(ACAU_CASE.points.length, 100);
  assert.deepEqual(ACAU_CASE.points[0], { time: 26, retention: 101.44 });
  assert.deepEqual(ACAU_CASE.points.at(-1), { time: 2605, retention: 5.53 });
  const strongest = detectRetentionSignals(ACAU_CASE.points).sort(
    (left, right) => Math.abs(right.delta) - Math.abs(left.delta),
  )[0];
  assert.equal(strongest.time, 78);
  assert.equal(strongest.delta, -42.5);
});

void test('official YouTube Analytics JSON preserves replay ratios above one', () => {
  const report = JSON.stringify({
    columnHeaders: [
      { name: 'elapsedVideoTimeRatio' },
      { name: 'audienceWatchRatio' },
    ],
    rows: [
      [0, 1],
      [0.5, 1.25],
      [1, 0.8],
    ],
  });
  assert.deepEqual(parseYouTubeAnalyticsReport(report, 100), [
    { time: 0, retention: 100 },
    { time: 50, retention: 125 },
    { time: 100, retention: 80 },
  ]);
});

void test('short-video advice and repairs stay inside the source duration', () => {
  const points = [100, 99, 70, 60, 58, 57].map((retention, index) => ({
    time: index * 2,
    retention,
  }));
  const signal = detectRetentionSignals(points)[0];
  assert.ok(signal);
  assert.ok(!signal.learnedRule.includes('20 seconds'));
  assert.ok(signal.repair.end <= 10);
});

void test('edit plans use the source-bound v2 contract', () => {
  const signal = detectRetentionSignals(
    [100, 98, 70, 60, 58].map((retention, index) => ({
      time: index * 5,
      retention,
    })),
  )[0];
  const source: SourceIdentity = {
    name: 'draft.mp4',
    sizeBytes: 123,
    durationSeconds: 20,
    sha256: 'a'.repeat(64),
  };
  const plan = createEditDecisionList(signal, source);
  assert.equal(plan.schema, 'retentiondna.edit-plan.v2');
  assert.deepEqual(plan.source, source);
});

void test('workflow reducer cannot keep a disabled better-cut state after failure', () => {
  const repaired = workflowReducer(initialWorkflowState, {
    type: 'STAGE_REPAIR',
  });
  const failed = workflowReducer(repaired, {
    type: 'ANALYZE_FAILURE',
    message: 'bad CSV',
  });
  assert.equal(failed.phase, 'ready');
  assert.equal(failed.cutMode, 'original');
  assert.equal(failed.error, 'bad CSV');
});
