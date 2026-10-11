import { log } from '../log.ts';
import { closeBeliefSession } from '../beliefs/runtime.ts';
import type { LoopDeps } from './deps.ts';
import { enqueue, dispatchMessage } from '../messages/outbox.ts';
import { config } from '../config.ts';
import { Scheduler } from '../schedule/scheduler.ts';

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
    if (await closeBeliefSession(deps, attempt.id, now)) continue;
    const id = await deps.store.raw.begin(async tx => {
      const [caller] = await tx`select phone_hash from callers where phone_hash = ${attempt.phoneHash} for update`;
      const [current] = await tx`select status, scheduled_for from call_attempts where id = ${attempt.id} for update`;
      if (!current || !['claimed', 'placed', 'settling'].includes(current['status'])) return undefined;
      await new Scheduler(tx).finish(attempt.id, 'failed', { note: `abandoned in ${current['status']}` });
      if (!caller) return undefined;
      const phone = await deps.store.in(tx).phoneFor(attempt.phoneHash);
      const base = config.link.publicUrl().replace(/\/$/, '');
      if (!phone || !base) return undefined;
      return enqueue(tx, { eventKey: `call:${attempt.id}:sms`, phoneHash: attempt.phoneHash, channel: 'sms', kind: 'call', reference: attempt.id,
        to: phone, body: (deps.script.get('sms.interrupted') ?? '').replace('{{link}}', `${base}/me`), expiresAt: new Date(+current['scheduled_for'] + 6 * 3600_000) }, now);
    });
    if (id) await dispatchMessage(deps, id, now);
  }
  if (stale.length) log('sweep.closed', { count: stale.length });
  return stale.length;
}
