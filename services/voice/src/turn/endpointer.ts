import type { Endpointing } from '../config.ts';

/**
 * Context-aware turn detection.
 *
 * The provider offers silence timing only (server_vad: threshold +
 * silence_duration_ms). Silence timing alone cuts off exactly the pause this
 * product exists to hold, and it does it most often to the person having the
 * hardest week. So we run turn-taking here, where we can use context, and the
 * logic is provider-neutral — it works identically behind a different stack.
 *
 * Default on a pause is always to WAIT. The rules below only ever ADD patience.
 */

const TRAILING = new Set([
  'and','but','so','because','cause','that','the','a','to','i','it','its',
  'like','just','um','uh','erm','well','maybe','if','or','then','my','was',
  'were','is','im','ive','id','we','they','he','she','you','of','for','with',
  'honestly','actually','kind','sort',
]);

/** Short acknowledgements while the agent speaks. Never a turn, never an interruption. */
const BACKCHANNEL = new Set([
  'mhm','mm','mmm','hm','hmm','uhhuh','uhuh','uh','huh','ah','yeah','yep','yes',
  'right','ok','okay','sure','true','no','wow','oh','i see','got it',
]);

export interface TurnContext {
  /** Words the user has produced in this turn so far (partial transcript). */
  partial: string;
  /** Script id of the agent's most recent question, if any. */
  lastAgentTurnId?: string;
  /** True when that question is marked hard in SCRIPT.md. */
  lastTurnWasHard: boolean;
  /** Per-user learned offset in ms, from their measured pause distribution. */
  userPatienceOffsetMs?: number;
}

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isBackchannel(text: string): boolean {
  const n = normalise(text);
  if (!n) return false;
  if (BACKCHANNEL.has(n)) return true;
  const words = n.split(' ');
  return words.length <= 2 && words.every((w) => BACKCHANNEL.has(w));
}

/** How long to wait after speech stops before treating the turn as finished. */
export function silenceBudgetMs(ctx: TurnContext, cfg: Endpointing): number {
  const n = normalise(ctx.partial);
  const words = n ? n.split(' ') : [];
  const last = words[words.length - 1];

  let budget = cfg.baseSilenceMs;

  // Trailed off mid-clause. They have not finished the sentence, let alone the thought.
  if (last && TRAILING.has(last)) budget = Math.max(budget, cfg.trailingClauseMs);

  // A one-word answer is usually the placeholder before the real answer.
  // Do not fill it, do not restate the question. Wait.
  if (words.length > 0 && words.length <= 2 && !isBackchannel(n)) {
    budget = Math.max(budget, cfg.shortAnswerMs);
  }

  // Nothing said at all yet in response to a question: hold the whole line open.
  if (words.length === 0) budget = Math.max(budget, cfg.trailingClauseMs);

  if (ctx.lastTurnWasHard) budget *= cfg.hardQuestionFactor;

  budget += ctx.userPatienceOffsetMs ?? 0;

  return Math.min(Math.round(budget), cfg.maxWaitMs);
}
