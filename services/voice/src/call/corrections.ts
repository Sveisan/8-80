import { isBackchannel } from '../turn/endpointer.ts';

/**
 * In-call learning. When the agent gets it wrong we do not wait for a release —
 * we append a note to a buffer that is included in every subsequent turn of
 * THIS call. The user hears one beat of acknowledgement and nothing else; they
 * should never hear the system learning.
 */
export type CorrectionKind =
  | 'user_talked_over_agent'
  | 'correction_phrase'
  | 'agent_cut_user_off';

const PHRASES: [RegExp, string][] = [
  [/\blet me finish\b/i, 'let me finish'],
  [/\bno,? i meant\b/i, 'no I meant'],
  [/\bthat'?s not what i said\b/i, 'not what I said'],
  [/\bi wasn'?t done\b/i, "wasn't done"],
  [/\bhold on\b/i, 'hold on'],
  [/\bas i was saying\b/i, 'as I was saying'],
  [/\bcan i finish\b/i, 'can I finish'],
];

export interface Correction {
  kind: CorrectionKind;
  /** Appended to the live context buffer. Never contains user content. */
  note: string;
  at: number;
}

export function detectCorrectionPhrase(text: string): Correction | null {
  for (const [re] of PHRASES) {
    if (re.test(text)) {
      return {
        kind: 'correction_phrase',
        note: 'The user signalled they were not finished. Extend patience: let silences run longer before responding, and do not ask a new question until they have clearly stopped.',
        at: Date.now(),
      };
    }
  }
  return null;
}

/**
 * The user spoke while the agent was speaking. A backchannel ("mhm") is NOT an
 * interruption and must not be counted as one — treating it as a barge-in is
 * one of the most machine-like failures available to us.
 */
export function classifyOverlap(text: string, overlapMs: number, backchannelMaxMs: number):
  | { type: 'backchannel' }
  | { type: 'interruption'; correction: Correction } {
  if (isBackchannel(text) || overlapMs <= backchannelMaxMs) return { type: 'backchannel' };
  return {
    type: 'interruption',
    correction: {
      kind: 'user_talked_over_agent',
      note: 'The user spoke over the agent. The agent was talking too long or started too early. Be briefer, and wait longer before starting to speak.',
      at: Date.now(),
    },
  };
}

/** The agent started while the user's sentence was unfinished. */
export function agentCutUserOff(): Correction {
  return {
    kind: 'agent_cut_user_off',
    note: 'The agent began speaking while the user was still mid-thought. They were still thinking — extend patience and wait through longer pauses.',
    at: Date.now(),
  };
}

export class CorrectionBuffer {
  private readonly items: Correction[] = [];
  add(c: Correction): void {
    if (this.items.some((i) => i.kind === c.kind)) return; // one note per kind, no pile-up
    this.items.push(c);
  }
  get all(): readonly Correction[] {
    return this.items;
  }
  /** Rendered into the instructions for every subsequent turn of this call. */
  render(): string {
    if (!this.items.length) return '';
    return ['', 'Adjustments for the rest of this call:', ...this.items.map((i) => `- ${i.note}`)].join('\n');
  }
}
