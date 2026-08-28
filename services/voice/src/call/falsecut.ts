import { isBackchannel } from '../turn/endpointer.ts';

/**
 * Estimating how often we cut someone off, on real calls, without a human
 * scoring anything.
 *
 * We cannot know directly that a person had more to say. But we can observe the
 * shape of it: we decided their turn was over, the agent began speaking, and
 * they immediately carried on. That is the signature of an early endpoint, and
 * it is measurable on every call for free.
 *
 * This is the metric that turns silence handling from a one-off test into a
 * standing instrument. It is deliberately conservative — a missed false cut is
 * better than a phantom one, because a phantom would push us towards waiting
 * longer for no reason.
 */
export interface FalseCutOptions {
  /** Resuming within this long of the endpoint reads as "I had not finished". */
  resumeWindowMs?: number;
}

export class FalseCutEstimator {
  private endpointedAt: number | null = null;
  private readonly window: number;
  private cuts = 0;

  constructor(opts: FalseCutOptions = {}) {
    this.window = opts.resumeWindowMs ?? 1500;
  }

  /** We judged the turn finished. */
  noteTurnEnd(at: number): void {
    this.endpointedAt = at;
  }

  /**
   * The user started speaking again. Returns true if this looks like a turn we
   * ended too early. A backchannel never counts — they are agreeing, not
   * resuming.
   */
  noteUserSpeech(at: number, partial: string): boolean {
    const endpointed = this.endpointedAt;
    this.endpointedAt = null;
    if (endpointed === null) return false;
    if (at - endpointed > this.window) return false;
    if (isBackchannel(partial)) return false;
    this.cuts++;
    return true;
  }

  /** A correction phrase confirms it independently: count it once. */
  noteCorrectionPhrase(): void {
    this.cuts++;
    this.endpointedAt = null;
  }

  get count(): number {
    return this.cuts;
  }
}
