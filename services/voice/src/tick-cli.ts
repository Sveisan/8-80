import { log } from './log.ts';
import { openDeps } from './control.ts';
import { tick } from './loop/tick.ts';
import { sweep } from './loop/sweep.ts';

/**
 * One tick, then exit. Meant for cron:
 *
 *     * * * * * cd /srv/8-80 && npm run tick
 *
 * A process per minute rather than a daemon with a timer, because a daemon that
 * dies at three in the morning is a product that silently stops calling anyone,
 * and cron restarting is somebody else's solved problem.
 */
const deps = openDeps();
try {
  const result = await tick(deps);
  // Hourly would be tidier, but a sweep that only runs from its own schedule is
  // a second thing that can stop running. This one cannot outlive the tick.
  const closed = await sweep(deps);
  // Same reasoning as the sweep: a retention window enforced by its own timer is
  // another thing that can quietly stop, and the failure is transcripts kept
  // forever. Hung off the tick, it cannot outlive the thing that makes calls.
  // Cheap because the column is indexed and almost every run deletes nothing.
  const pruned = (await deps.deliveries?.prune()) ?? 0;
  if (result.claimed || closed || pruned) log('tick.summary', { ...result, swept: closed, pruned });
} finally {
  await deps.store.close();
}
