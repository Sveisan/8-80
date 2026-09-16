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
  if (result.claimed || closed) log('tick.summary', { ...result, swept: closed });
} finally {
  await deps.store.close();
}
