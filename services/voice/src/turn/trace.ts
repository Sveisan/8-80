/**
 * Recording the timing of a real call so it can become a replay fixture.
 *
 * The endpointer's decisions depend on three things about what was said: how
 * many words, whether the last one trails off, and whether the whole thing was
 * a backchannel. It does NOT depend on which words. So we record only those
 * three, and the replay reconstructs a synthetic utterance that behaves
 * identically.
 *
 * The consequence is that a trace contains no transcript, no voice and nothing
 * that identifies anyone — so real calls can seed the corpus without any of it
 * needing encryption, retention rules, or a deletion path.
 */
import { endsWithTrailingWord, isBackchannel, normalise } from './endpointer.ts';

const TRAILING_PROBE = 'because';
const PLAIN_PROBE = 'done';

export interface TraceSegment {
  startMs: number;
  endMs: number;
  words: number;
  endsTrailing: boolean;
  backchannel: boolean;
}

export interface CallTrace {
  capturedAt: string;
  sensitivity: number;
  segments: TraceSegment[];
  /** Turns the false-cut estimator flagged. These are the ones worth labelling. */
  suspectedCutsAtMs: number[];
  durationMs: number;
}

/** Rebuilds an utterance that the endpointer treats exactly like the original. */
export function syntheticPartial(seg: Pick<TraceSegment, 'words' | 'endsTrailing' | 'backchannel'>): string {
  if (seg.backchannel) return 'mhm';
  if (seg.words <= 0) return '';
  const head = Array.from({ length: Math.max(0, seg.words - 1) }, () => 'word');
  head.push(seg.endsTrailing ? TRAILING_PROBE : PLAIN_PROBE);
  return head.join(' ');
}

export class TraceRecorder {
  private readonly segments: TraceSegment[] = [];
  private readonly cuts: number[] = [];
  private openStartMs: number | null = null;

  speechStart(atMs: number): void {
    if (this.openStartMs === null) this.openStartMs = atMs;
  }

  /** Close the current segment. `partial` is used only to derive the flags. */
  speechEnd(atMs: number, partial: string): void {
    if (this.openStartMs === null) return;
    const words = normalise(partial).split(' ').filter(Boolean);
    this.segments.push({
      startMs: this.openStartMs,
      endMs: atMs,
      words: words.length,
      endsTrailing: endsWithTrailingWord(partial),
      backchannel: isBackchannel(partial),
    });
    this.openStartMs = null;
  }

  suspectedCut(atMs: number): void {
    this.cuts.push(atMs);
  }

  build(sensitivity: number, durationMs: number): CallTrace {
    return {
      capturedAt: new Date().toISOString(),
      sensitivity,
      segments: this.segments,
      suspectedCutsAtMs: this.cuts,
      durationMs,
    };
  }
}
