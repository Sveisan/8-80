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
  if (said('last.did')) return 'done';
  if (said('last.partial')) return 'partly';
  if (['nothing.a', 'nothing.b', 'nothing.c.follow', 'nothing.pattern', 'block.ask'].some(said)) return 'undone';
  return undefined;
}
