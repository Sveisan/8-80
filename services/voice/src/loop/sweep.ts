import { log } from '../log.ts';
import type { LoopDeps } from './deps.ts';

/**
 * Calls that were claimed and then went quiet.
 *
 * A claim that never became a call, a call that never produced a webhook, a
 * settlement that died halfway — each is a week somebody silently did not get,
 * and none of them raises anything on its own. This is the only thing that
 * looks.
 *
 * It closes them rather than retrying them. Ringing somebody four hours late is
 * not the weekly call, and a sweep that decided otherwise would turn an outage
 * into a burst of calls at whatever hour it recovered.
 */
export async function sweep(deps: LoopDeps, olderThanMs = 60 * 60_000, now = new Date()): Promise<number> {
  const stale = await deps.scheduler.stale(olderThanMs, now);
  for (const attempt of stale) {
    await deps.scheduler.finish(attempt.id, 'failed', { note: `abandoned in ${attempt.status}` });
  }
  if (stale.length) log('sweep.closed', { count: stale.length });
  return stale.length;
}
