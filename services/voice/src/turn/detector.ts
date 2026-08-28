import type { Endpointing } from '../config.ts';
import { isBackchannel, normalise, silenceBudgetMs } from './endpointer.ts';

/**
 * The turn-taking state machine, extracted so that the live call and the
 * offline replay harness run the SAME code. A replay corpus that tested a copy
 * of this logic would be worse than no corpus at all.
 */
export type DetectorEvent =
  | { kind: 'speech_start'; at: number }
  | { kind: 'turn_end'; at: number; waitedMs: number; budgetMs: number; reason: string }
  | { kind: 'backchannel_end'; at: number }
  | null;

export interface DetectorContext {
  lastTurnWasHard: boolean;
  patienceOffsetMs?: number;
}

export function budgetReason(partial: string, hard: boolean): string {
  const words = normalise(partial).split(' ').filter(Boolean);
  if (hard) return 'hard-turn';
  if (words.length === 0) return 'nothing-said-yet';
  if (words.length <= 2) return 'short-answer';
  return 'base';
}

export class TurnDetector {
  private cfg: Endpointing;
  private ctx: DetectorContext = { lastTurnWasHard: false };
  private speaking = false;
  private pending = false;
  private lastVoiceAt = 0;
  private startedAt = 0;
  private longestPauseInTurnMs = 0;

  constructor(cfg: Endpointing) {
    this.cfg = cfg;
  }

  setContext(ctx: DetectorContext): void {
    this.ctx = ctx;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  speakingForMs(now: number): number {
    return this.speaking ? now - this.startedAt : 0;
  }

  /** One audio frame. `loud` is whether the frame carries speech energy. */
  frame(loud: boolean, partial: string, now: number): DetectorEvent {
    if (loud) {
      if (this.speaking && this.pending) {
        // They stopped and came back. Remember how long they were gone for.
        const pause = now - this.lastVoiceAt;
        if (pause > this.longestPauseInTurnMs) this.longestPauseInTurnMs = pause;
      }
      this.lastVoiceAt = now;
      if (!this.speaking) {
        this.speaking = true;
        this.pending = true;
        this.startedAt = now;
        this.longestPauseInTurnMs = 0;
        return { kind: 'speech_start', at: now };
      }
      return null;
    }

    if (!this.speaking || !this.pending) return null;

    const waitedMs = now - this.lastVoiceAt;
    const budgetMs = silenceBudgetMs(
      {
        partial,
        lastTurnWasHard: this.ctx.lastTurnWasHard,
        userPatienceOffsetMs: this.ctx.patienceOffsetMs,
        longestPauseInTurnMs: this.longestPauseInTurnMs,
      },
      this.cfg,
    );
    if (waitedMs < budgetMs) return null;

    this.speaking = false;
    this.pending = false;

    if (isBackchannel(partial)) return { kind: 'backchannel_end', at: now };
    return { kind: 'turn_end', at: now, waitedMs, budgetMs, reason: budgetReason(partial, this.ctx.lastTurnWasHard) };
  }
}
