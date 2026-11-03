import { createHash } from 'node:crypto';
import type { Database } from '../store/transaction.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { localDate, zonedTimeToUtc } from '../schedule/time.ts';
import { sameMessageNumber } from '../agent/voices.ts';
import { enqueue } from '../messages/outbox.ts';

const MINUTE = 60_000;
/** Local daytime, including on dates where the UTC offset changes. */
export function nudgeWindow(now: Date, timezone: string): { start: Date; end: Date } {
  const d = localDate(now, timezone);
  return { start: zonedTimeToUtc(d.year, d.month, d.day, 600, timezone), end: zonedTimeToUtc(d.year, d.month, d.day, 1080, timezone) };
}
/** A stable random slot 2–4 local calendar days away; ticks never reroll it. */
export function nextNudgeAfter(now: Date, timezone: string, seed: string): Date {
  const d = localDate(now, timezone);
  const hash = createHash('sha256').update(`${seed}:${d.year}-${d.month}-${d.day}`).digest();
  const day = new Date(Date.UTC(d.year, d.month - 1, d.day + 2 + hash[0]! % 3));
  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 600 + hash.readUInt16BE(1) % 480, timezone);
}
export async function setNudges(sql: Database, hash: string, enabled: boolean, timezone: string, now = new Date()): Promise<void> {
  if (enabled && !sameMessageNumber()) throw new Error('Same-number messaging is unavailable.');
  await sql`select phone_hash from callers where phone_hash = ${hash} for update`;
  await sql`update callers set nudges_enabled = ${enabled}, next_nudge_at = ${enabled ? nextNudgeAfter(now, timezone, hash) : null}, nudge_sequence = nudge_sequence + 1, updated_at = ${now} where phone_hash = ${hash}`;
  // A saved opt-out also invalidates already composed messages, including after re-enabling.
  await sql`update message_outbox set status = 'suppressed', reason = 'preference_changed', payload_enc = null, recipient_enc = null
    where phone_hash = ${hash} and kind = 'nudge' and status = 'pending'`;
}
/** Only records intent. The normal outbox owns delivery and rechecks every control. */
export async function queueDueNudges(deps: LoopDeps, now = new Date()): Promise<number> {
  if (!sameMessageNumber()) return 0;
  const rows = await deps.store.raw<{ phone_hash: string }[]>`select phone_hash from callers where nudges_enabled = true and next_nudge_at <= ${now} order by next_nudge_at limit 50`;
  let queued = 0;
  for (const row of rows) await deps.store.raw.begin(async tx => {
    const [c] = await tx`select *,
      (not paused and not all_calls_stopped and not sms_opt_out and not held_for_review and call_number > 1
        and onboarding in ('complete', 'legacy')
        and (billing_status in ('comped','active','past_due') or (billing_status = 'trialing' and (trial_ends_at is null or trial_ends_at > ${now})))
        and (not cancel_at_period_end or paid_until > ${now})) as eligible
      from callers where phone_hash = ${row.phone_hash} and nudges_enabled = true and next_nudge_at <= ${now} for update`;
    if (!c) return;
    const zone = c['timezone'];
    if (typeof zone !== 'string') return;
    const window = nudgeWindow(now, zone);
    const due = c['next_nudge_at'] as Date;
    await tx`update callers set next_nudge_at = ${nextNudgeAfter(now, zone, row.phone_hash)} where phone_hash = ${row.phone_hash}`;
    // No catch-up burst after downtime, and no optional text during a call.
    if (!c['eligible'] || now < window.start || now >= window.end || +now - +due > 120 * MINUTE) return;
    const active = await tx`select id from call_attempts where phone_hash = ${row.phone_hash} and status in ('claimed','placed','active') limit 1`;
    if (active.length) return;
    const sequence = Number(c['nudge_sequence']);
    const body = deps.script.get(`sms.nudge.${sequence % 8}`);
    const phone = await deps.store.in(tx).phoneFor(row.phone_hash);
    if (!body || !phone) return;
    await enqueue(tx, { eventKey: `nudge:${row.phone_hash}:${due.toISOString()}`, phoneHash: row.phone_hash, channel: 'sms', kind: 'nudge', to: phone, reference: String(sequence + 1),
      body, expiresAt: new Date(Math.min(+window.end, +now + 120 * MINUTE)) }, now);
    await tx`update callers set nudge_sequence = nudge_sequence + 1 where phone_hash = ${row.phone_hash}`;
    queued++;
  });
  return queued;
}
