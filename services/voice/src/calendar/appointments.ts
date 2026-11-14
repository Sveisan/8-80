import type { Database } from '../store/transaction.ts';
import { BeliefRepository } from '../beliefs/repository.ts';
import { activeBeliefs } from '../beliefs/model.ts';
import { beliefConfig } from '../beliefs/config.ts';
import { UnblockRepository, callsAllowed, scheduleOf } from '../unblock/repository.ts';
import { lightEnabled, slotKind } from '../unblock/model.ts';
import { unblockConfig } from '../unblock/config.ts';

export interface Appointment { key: string; at: Date; timezone: string; }

/** Only stored appointments. Never expand a cadence into a recurring series. */
export async function bookedAppointments(sql: Database, hash: string, now: Date): Promise<Appointment[]> {
  const [c] = await sql`select * from callers where phone_hash = ${hash}`;
  if (!c || c['all_calls_stopped'] || c['held_for_review'] || c['sms_opt_out']) return [];
  const appointments: Appointment[] = [];
  const add = (key: string, at: Date | null, timezone: string): void => {
    if (at && at > now) appointments.push({ key, at, timezone });
  };
  const at = c['next_call_at'] as Date | null;
  const eligible = at && (['comped', 'active', 'past_due'].includes(c['billing_status']) || c['billing_status'] === 'trialing' && (!c['trial_ends_at'] || c['trial_ends_at'] > at));
  if (!c['paused'] && eligible && (!c['cancel_at_period_end'] || c['paid_until'] && c['paid_until'] > at!) && c['timezone'] && c['slot_weekday'] !== null && c['slot_minute'] !== null) add('weekly', at, c['timezone']);

  // Additional products may have more than one explicitly booked kind of call.
  if (beliefConfig().live) {
    const loaded = await new BeliefRepository(sql).load(hash);
    if (loaded?.enrollment.standing === 'active' && loaded.practice.state !== 'paused') {
      const { enrollment: e, practice: p } = loaded;
      const put = (kind: string, date: Date | null): void => add(`beliefs:${e.id}:${kind}`, date, e.timezone);
      if (p.state === 'completed') { if (!e.checkin_used_at) put('checkin', e.checkin_at); }
      else if (!p.understood) put('onboarding', e.onboarding_at);
      else { if (activeBeliefs(p).length) put('daily', e.next_daily_at); put('weekly', e.next_weekly_at); }
    }
  }
  if (unblockConfig().live) {
    const loaded = await new UnblockRepository(sql).load(hash);
    if (loaded?.programme.state === 'active' && callsAllowed(loaded.enrollment, now)) {
      const { enrollment: e, programme: p } = loaded;
      const put = (kind: string, date: Date | null): void => {
        if (date && callsAllowed(e, date)) add(`unblock:${e.id}:${kind}`, date, e.timezone);
      };
      const kind = slotKind(p);
      if (kind === 'opening') put('opening', e.opening_at ?? e.next_weekly_at);
      else if (kind === 'weekly') put('weekly', e.next_weekly_at);
      if (lightEnabled(p, scheduleOf(e))) put('light', e.next_light_at);
    }
  }
  return appointments;
}

export async function callInProgress(sql: Database, hash: string): Promise<boolean> {
  const rows = await sql`select id from call_attempts where phone_hash = ${hash} and status in ('claimed', 'placed', 'active', 'settling') limit 1`;
  return rows.length > 0;
}
