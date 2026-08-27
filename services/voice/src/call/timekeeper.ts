import type { ScriptLines } from '../script.ts';

/**
 * Time is mentioned as courtesy, once each, and then dropped entirely.
 *
 * The suppression is the whole point. Interrupting a hard moment with a billing
 * notice is the worst thing this product could do, and it is exactly when a
 * naive timer would fire. If no natural break ever comes, the line is never
 * said — silence is always preferable to landing it badly.
 */
export type Mention = 'five_left' | 'limit';

export interface TimekeeperOptions {
  limitMs: number;
  /** Do not speak within this long of a disclosure or a hard turn. */
  suppressAfterSensitiveMs?: number;
}

export class Timekeeper {
  private said = new Set<Mention>();
  private lastSensitiveAt = 0;
  private readonly suppressMs: number;

  constructor(
    private readonly script: ScriptLines,
    private readonly opts: TimekeeperOptions,
  ) {
    this.suppressMs = opts.suppressAfterSensitiveMs ?? 120_000;
  }

  /** Called whenever the user says something difficult, or a hard turn is asked. */
  markSensitive(at = Date.now()): void {
    this.lastSensitiveAt = at;
  }

  /**
   * Returns the line to say, or null. Natural break means: the agent is not
   * speaking, the user is not speaking, and nothing sensitive is recent.
   */
  due(elapsedMs: number, atNaturalBreak: boolean, now = Date.now()): { mention: Mention; text: string } | null {
    if (!atNaturalBreak) return null;
    if (now - this.lastSensitiveAt < this.suppressMs) return null;

    const remaining = this.opts.limitMs - elapsedMs;
    if (!this.said.has('five_left') && remaining <= 5 * 60_000 && remaining > 0) {
      this.said.add('five_left');
      return { mention: 'five_left', text: this.script.get('time.five_left') ?? '' };
    }
    if (!this.said.has('limit') && remaining <= 0) {
      this.said.add('limit');
      return { mention: 'limit', text: this.script.get('time.limit') ?? '' };
    }
    return null;
  }

  /** No countdown, no second reminder, no closing pressure, ever. */
  get finished(): boolean {
    return this.said.has('five_left') && this.said.has('limit');
  }
}
