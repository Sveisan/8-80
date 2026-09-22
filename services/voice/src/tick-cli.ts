import { log } from './log.ts';
import { openDeps } from './control.ts';
import { tick } from './loop/tick.ts';
import { sweep } from './loop/sweep.ts';
import { expireTrials } from './billing/trials.ts';
import { beat } from './schedule/scheduler.ts';

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
  // Hung off the tick for the third time and the same reason. The calls have
  // already stopped for an expired trial — claimDue reads the date itself —
  // so all this does is tell them, and a telling that runs on its own timer is
  // a telling that can stop while the stopping carries on.
  const ended = await expireTrials(deps);
  if (result.claimed || closed || pruned || ended) {
    log('tick.summary', { ...result, swept: closed, pruned, trialsEnded: ended });
  }

  // Always, including the quiet runs. A tick logs only when it claims a call,
  // so "running and nothing was due" and "stopped three hours ago" leave
  // identical evidence in the journal — which cost an evening of guessing
  // before this row existed.
  await beat(
    deps.store.raw,
    'tick',
    result.claimed ? `claimed ${result.claimed}, placed ${result.placed}, failed ${result.failed}` : undefined,
  );
} finally {
  await deps.store.close();
}
