import type { ScriptLines } from '../script.ts';
import { carries } from './scorecard.ts';

/** Whether last week's one thing happened, as the call established it. */
export type LastWeek = 'done' | 'partly' | 'undone';

/**
 * Read from which branch the mentor took, not from the caller's words.
 *
 * SCRIPT.md §2 answers each outcome with its own line — "How was it", "So some
 * of it", and the §3 lines for nothing — so the line the mentor chose is the
 * call's own verdict, said out loud, and costs the caller no extra turn. A
 * paraphrase that matches none of them leaves the week unrecorded, which is
 * the safe failure: a week wrongly counted as undone moves somebody toward
 * "third week running", and that is a question nobody should be asked twice
 * by mistake.
 *
 * `nothing.c` is a bare "Mm." and indistinguishable from any other, so an
 * undone week is only known once the mentor asks what got in the way.
 */
export function lastWeek(agentTurns: readonly string[], script: ScriptLines): LastWeek | undefined {
  const said = (id: string) => {
    const line = script.get(id);
    return !!line && agentTurns.some((t) => carries(t, line));
  };
  // A first call has no last week, and saying so here is not belt-and-braces.
  // `block.first` ("And what usually gets in the way of it?") shares four of
  // the five words in `block.ask` ("What was in the way?"), which is exactly
  // the 0.8 overlap `carries` accepts — so every first call was being recorded
  // as an undone week, incrementing the running count and telling next week's
  // mentor that somebody who has only ever had one call had already failed one.
  // Rewording either line would fix this pair and leave the next pair to be
  // found on somebody's third week, which is the question this file exists to
  // keep nobody from being asked by mistake.
  if (said('block.first')) return undefined;

  if (said('last.did')) return 'done';
  if (said('last.partial')) return 'partly';
  if (['nothing.a', 'nothing.b', 'nothing.c.follow', 'nothing.pattern', 'block.ask'].some(said)) return 'undone';
  return undefined;
}
