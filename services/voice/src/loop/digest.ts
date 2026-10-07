import { config } from '../config.ts';
import { log } from '../log.ts';
import { alertText } from '../call/safety.ts';
import { awaitingReview, beat, heartbeats } from '../schedule/scheduler.ts';
import type { LoopDeps } from './deps.ts';

const JOB = 'safety-digest';

/**
 * Once a day, after the operator's digest hour, one text counting the calls
 * still waiting for review — tier 2 are gathered here; tier 1 were texted the
 * evening they happened but are counted again until somebody clears them.
 *
 * Runs from the tick, which runs every minute, so it decides for itself
 * whether today's text has gone: the heartbeat is the record. Nothing is sent
 * when nothing waits. Never throws: a digest must not be what stops a call.
 */
export async function safetyDigest(deps: LoopDeps, now = new Date()): Promise<void> {
  try {
    const to = config.operator.phones();
    if (!to.length) return;
    const tz = config.operator.timezone;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(now));
    if (hour < config.operator.digestHour) return;

    const today = localDate(now, tz);
    const last = (await heartbeats(deps.store.raw)).find((b) => b.job === JOB);
    if (last && localDate(last.at, tz) === today) return;

    const waiting = await awaitingReview(deps.store.raw);
    if (waiting.length) {
      for (const phone of to) {
        try {
          await deps.sms.send(phone, alertText(2, waiting.length));
        } catch (e) {
          log('safety.digest_failed', { reason: (e as Error).message });
        }
      }
      log('safety.digest', { waiting: waiting.length });
    }
    await beat(deps.store.raw, JOB, `${waiting.length} waiting`);
  } catch (e) {
    log('safety.digest_failed', { reason: (e as Error).message });
  }
}

function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
