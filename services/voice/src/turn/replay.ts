import type { Endpointing } from '../config.ts';
import { TurnDetector } from './detector.ts';

/**
 * Offline replay of a conversation's TIMING against the real turn detector.
 *
 * A fixture is a timing trace — when speech started and stopped, and the words
 * so far. Deliberately not audio: timings carry no voice, no content that
 * identifies anyone, and nothing that needs encrypting or deleting, so a corpus
 * of them can live in the repository and grow forever without becoming a
 * privacy liability.
 *
 * `trueEndMs` is the moment the speaker actually finished. Endpointing before
 * it is a false cut — the failure this product cannot ship.
 */
export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Fixture {
  id: string;
  description: string;
  lastTurnWasHard?: boolean;
  patienceOffsetMs?: number;
  /** When the person genuinely stopped having more to say. */
  trueEndMs: number;
  /** Set when the trace is only a backchannel and must not produce a turn. */
  expectNoTurn?: boolean;
  durationMs: number;
  segments: Segment[];
}

export interface ReplayResult {
  id: string;
  endpointedAtMs: number | null;
  waitedMs: number | null;
  budgetMs: number | null;
  reason: string | null;
  /** We ended the turn while they still had more to say. The failure that matters. */
  falseCut: boolean;
  /** How long past their actual finish we waited. The price of being careful. */
  latenessMs: number | null;
  sawBackchannelOnly: boolean;
}

const FRAME_MS = 20;

export function replay(f: Fixture, cfg: Endpointing): ReplayResult {
  const det = new TurnDetector(cfg);
  det.setContext({ lastTurnWasHard: f.lastTurnWasHard ?? false, patienceOffsetMs: f.patienceOffsetMs });

  let endpointedAtMs: number | null = null;
  let waitedMs: number | null = null;
  let budgetMs: number | null = null;
  let reason: string | null = null;
  let sawBackchannelOnly = false;

  for (let t = 0; t <= f.durationMs; t += FRAME_MS) {
    const seg = f.segments.find((s) => t >= s.startMs && t < s.endMs);
    const partial = f.segments
      .filter((s) => s.startMs <= t)
      .map((s) => s.text)
      .join(' ')
      .trim();

    const ev = det.frame(Boolean(seg), partial, t);
    if (!ev) continue;
    if (ev.kind === 'backchannel_end') {
      sawBackchannelOnly = true;
      continue;
    }
    if (ev.kind === 'turn_end') {
      endpointedAtMs = ev.at;
      waitedMs = ev.waitedMs;
      budgetMs = ev.budgetMs;
      reason = ev.reason;
      break;
    }
  }

  return {
    id: f.id,
    endpointedAtMs,
    waitedMs,
    budgetMs,
    reason,
    falseCut: endpointedAtMs !== null && endpointedAtMs < f.trueEndMs,
    latenessMs: endpointedAtMs === null ? null : Math.max(0, endpointedAtMs - f.trueEndMs),
    sawBackchannelOnly,
  };
}
