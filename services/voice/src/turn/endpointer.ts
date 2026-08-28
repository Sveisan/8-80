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

/**
 * Words that almost never end a finished thought. "it", "its" and "that" are
 * deliberately absent: as a final word they usually complete an object
 * ("I was avoiding it") rather than trail off, and treating them as trailing
 * made the agent wait absurdly long at the end of ordinary sentences.
 */
const TRAILING = new Set([
  // conjunctions and subordinators
  'and','but','so','because','cause','or','if','then','than','when','while',
  'after','before','since','as','though','although','unless','whether',
  // prepositions — the commonest real-world giveaway of an unfinished clause
  'on','in','at','to','from','about','into','over','under','up','out','off',
  'with','of','for','by','through','around','between','without','towards',
  // articles and determiners
  'the','a','an','my','your','our','their','this','these','those','some','any',
  // pronouns and auxiliaries left hanging
  'i','im','ive','id','we','they','he','she','you','was','were','is','are','am',
  'been','being','have','has','had','will','would','could','should','might',
  'must','do','does','did','get','got','going','gonna',
  // hedges and fillers
  'like','just','um','uh','erm','well','maybe','honestly','actually','kind',
  'sort','really','very','quite','still','always','never','also','too',
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
  /** Longest pause they have already paused-and-resumed through in THIS turn. */
  longestPauseInTurnMs?: number;
}

export function normalise(text: string): string {
  // Apostrophes are dropped, not spaced: "didn't" is one word, not two, and
  // "I've" must reduce to `ive` so the trailing set can match it.
  return text
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether the final word of an utterance leaves the clause hanging. */
export function endsWithTrailingWord(text: string): boolean {
  const words = normalise(text).split(' ').filter(Boolean);
  const last = words[words.length - 1];
  return last !== undefined && TRAILING.has(last);
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

  let budget = cfg.baseSilenceMs;

  // Trailed off mid-clause. They have not finished the sentence, let alone the thought.
  if (endsWithTrailingWord(ctx.partial)) budget = Math.max(budget, cfg.trailingClauseMs);

  // A one-word answer is usually the placeholder before the real answer.
  // Do not fill it, do not restate the question. Wait.
  if (words.length > 0 && words.length <= 2 && !isBackchannel(n)) {
    budget = Math.max(budget, cfg.shortAnswerMs);
  }

  // Nothing said at all yet in response to a question: hold the whole line open.
  if (words.length === 0) budget = Math.max(budget, cfg.trailingClauseMs);

  if (ctx.lastTurnWasHard) budget *= cfg.hardQuestionFactor;

  // They have already stopped and started again in this turn. Whatever the
  // words say, they are thinking in fragments, and the next gap deserves at
  // least as much room as the last one they came back from.
  const seen = ctx.longestPauseInTurnMs ?? 0;
  if (seen > 0) {
    budget = Math.max(budget, Math.min(seen * cfg.withinTurnPauseFactor, cfg.withinTurnMaxMs));
  }

  budget += ctx.userPatienceOffsetMs ?? 0;

  return Math.min(Math.round(budget), cfg.maxWaitMs);
}
