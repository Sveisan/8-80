import { config } from '../config.ts';
import { log } from '../log.ts';
import { alertText } from '../call/safety.ts';
import { awaitingReview, beat, heartbeats } from '../schedule/scheduler.ts';
import type { LoopDeps } from './deps.ts';
import { enqueue, dispatchMessage } from '../messages/outbox.ts';
import { unblockConfig } from '../unblock/config.ts';

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
    const waiting = await awaitingReview(deps.store.raw);
    const moduleRows = await deps.store.raw<{ id: string }[]>`select s.id from unblock_sessions s join call_attempts a on a.id=s.id where a.safety_tier is not null and a.safety_reviewed_at is null`;
    const unblock = new Set(moduleRows.map(r => r.id));
    const operator = unblockConfig().operatorPhone;
    const groups = [
      { job: JOB, to: config.operator.phones(), timezone: config.operator.timezone, hour: config.operator.digestHour, waiting: waiting.filter(r => !unblock.has(r.id)), unblock: false },
      { job: 'unblock-safety-digest', to: operator ? [operator] : [], timezone: 'Europe/Oslo', hour: 9, waiting: waiting.filter(r => unblock.has(r.id)), unblock: true },
    ];
    const beats = await heartbeats(deps.store.raw);
    for (const group of groups) {
      const { job, to, timezone: tz, waiting } = group;
      const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(now));
      const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(now);
      if (!to.length || hour < group.hour || (group.unblock && (hour >= 17 || ['Sat', 'Sun'].includes(weekday)))) continue;
      const today = localDate(now, tz);
      const last = beats.find(b => b.job === job);
      if (last && localDate(last.at, tz) === today) continue;
      if (waiting.length) {
        const ids=await deps.store.raw.begin(async tx=>{
          const ids:string[]=[];
          for(const [index,phone] of to.entries())ids.push(await enqueue(tx,{eventKey:`${group.unblock ? 'unblock:' : ''}safety:digest:${today}:${index}`,phoneHash:waiting[0]!.phoneHash,channel:'sms',kind:'safety',to:phone,body:group.unblock ? `Unblock: ${waiting.length} call(s) waiting for human review. Calls remain on hold. Review privately on the server.` : alertText(2,waiting.length)},now));
          return ids;
        });
        // A failed/uncertain transport stays in the outbox; the heartbeat never erases that intent.
        for(const id of ids)await dispatchMessage(deps,id,now);
        log('safety.digest', { module: group.unblock ? 'unblock' : 'shared', waiting: waiting.length });
      }
      await beat(deps.store.raw, job, `${waiting.length} waiting`);
    }
  } catch {
    log('safety.digest_failed', { reason: 'digest unavailable; check private outbox status' });
  }
}

function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
