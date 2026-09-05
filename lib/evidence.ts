import type { RetentionSignal } from '@/lib/retention';

export type TranscriptLine = { time: number; end: number; text: string };
export type EvidenceStatus = 'measured' | 'aligned' | 'unavailable';

export type EvidenceCueData = {
  label: string;
  value: string;
  basis: string;
  kind: 'curve' | 'audio' | 'visual' | 'transcript';
  status: EvidenceStatus;
};

export function alignedTranscriptWindow(
  time: number,
  lines: TranscriptLine[],
): TranscriptLine[] {
  if (!lines.length) return [];
  const found = lines.findIndex(
    (line) => time >= line.time && time <= line.end,
  );
  if (found < 0) return [];
  const start = Math.max(0, Math.min(found - 1, Math.max(0, lines.length - 3)));
  return lines.slice(start, start + 3);
}

export function evidenceFor(
  signal: RetentionSignal,
  sample: boolean,
  alignedTranscript: TranscriptLine[],
  transcriptSupplied: boolean,
): EvidenceCueData[] {
  const curve: EvidenceCueData = {
    label: 'Retention',
    value: `${signal.delta > 0 ? '+' : ''}${Math.round(signal.delta)} pts`,
    basis: 'Measured from the imported curve',
    kind: 'curve',
    status: 'measured',
  };
  if (sample && signal.time >= 20 && signal.time <= 35) {
    return [
      curve,
      {
        label: 'Audio',
        value: '7.0s silence',
        basis: 'Measured by FFmpeg in the sample',
        kind: 'audio',
        status: 'measured',
      },
      {
        label: 'Visual',
        value: '3 scene changes',
        basis: 'Measured by FFmpeg in the sample',
        kind: 'visual',
        status: 'measured',
      },
    ];
  }
  return [
    curve,
    {
      label: 'Transcript',
      value: alignedTranscript.length
        ? `${alignedTranscript.length} segments`
        : transcriptSupplied
          ? 'No overlap'
          : 'Not supplied',
      basis: alignedTranscript.length
        ? 'Timestamp overlap at this signal'
        : 'No transcript evidence at this moment',
      kind: 'transcript',
      status: alignedTranscript.length ? 'aligned' : 'unavailable',
    },
    {
      label: 'Visual',
      value: sample ? 'Local plan available' : 'Not analyzed here',
      basis: sample
        ? 'Inspect the verified local edit plan'
        : 'Run the local engine for scene evidence',
      kind: 'visual',
      status: sample ? 'measured' : 'unavailable',
    },
  ];
}
