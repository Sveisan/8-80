import { mkdirSync, writeFileSync } from 'node:fs';
import type { CallTrace } from './turn/trace.ts';
import { resolve } from 'node:path';

/** Objective per-call metrics. Never contains transcript content. */
export interface TurnMetric {
  index: number;
  /** Silence we actually waited before deciding the turn was over. */
  endpointLatencyMs: number;
  /** Budget the endpointer computed for that turn, and why. */
  budgetMs: number;
  reason: string;
  hardTurn: boolean;
}

export class CallMetrics {
  readonly startedAt = Date.now();
  timeToFirstAudioMs: number | null = null;
  falseInterruptions = 0;
  backchannelsIgnored = 0;
  bargeIns = 0;
  corrections: string[] = [];
  turns: TurnMetric[] = [];
  endedAt: number | null = null;
  /** Timing only — no words, no audio. Seeds the replay corpus. */
  trace: CallTrace | null = null;
  /** The voice provider's session opened. */
  voiceReady = false;
  /** The last error the voice provider reported, if any. */
  voiceError: string | null = null;

  firstAudio(at = Date.now()): void {
    if (this.timeToFirstAudioMs === null) this.timeToFirstAudioMs = at - this.startedAt;
  }

  get durationMs(): number {
    return (this.endedAt ?? Date.now()) - this.startedAt;
  }

  /**
   * Cost is left null unless rates are configured. We do not have current
   * Norwegian (+47) mobile termination rates or confirmed voice-model pricing,
   * and a made-up number in a cost model is worse than an empty field.
   */
  cost(): { currency: string; telephony: number | null; model: number | null; total: number | null } {
    const perMinTel = process.env.TELEPHONY_RATE_PER_MIN ? Number(process.env.TELEPHONY_RATE_PER_MIN) : null;
    const perMinModel = process.env.VOICE_MODEL_RATE_PER_MIN ? Number(process.env.VOICE_MODEL_RATE_PER_MIN) : null;
    const mins = this.durationMs / 60000;
    const tel = perMinTel === null ? null : +(perMinTel * mins).toFixed(4);
    const mod = perMinModel === null ? null : +(perMinModel * mins).toFixed(4);
    return {
      currency: process.env.COST_CURRENCY ?? 'USD',
      telephony: tel,
      model: mod,
      total: tel === null || mod === null ? null : +(tel + mod).toFixed(4),
    };
  }

  summary(): Record<string, unknown> {
    const lat = this.turns.map((t) => t.endpointLatencyMs).sort((a, b) => a - b);
    const median = lat.length ? lat[Math.floor(lat.length / 2)] : null;
    return {
      durationMs: this.durationMs,
      timeToFirstAudioMs: this.timeToFirstAudioMs,
      turns: this.turns.length,
      medianEndpointLatencyMs: median,
      falseInterruptions: this.falseInterruptions,
      backchannelsIgnored: this.backchannelsIgnored,
      bargeIns: this.bargeIns,
      corrections: this.corrections,
      cost: this.cost(),
    };
  }

  save(dir: string, name: string): string {
    mkdirSync(dir, { recursive: true });
    const path = resolve(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify({ summary: this.summary(), turns: this.turns }, null, 2));
    return path;
  }
}
