import { nextSlotAfter } from './time.ts';

export interface ResumeSchedule {
  slot_weekday: number | null;
  slot_minute: number | null;
  timezone: string | null;
  next_call_at: Date | null;
  billing_status: string;
  trial_ends_at: Date | null;
  cancel_at_period_end: boolean;
  paid_until: Date | null;
  held_for_review: boolean;
  all_calls_stopped: boolean;
}

/** The account preview and the locked resume action use the same eligibility rules. */
export function resumeAppointment(row: ResumeSchedule, now: Date):
  { at: Date; keepCycle: boolean } | { reason: 'unavailable' | 'trial_ends' | 'paid_period_ends' } {
  if (row.held_for_review || row.all_calls_stopped || row.slot_weekday === null || row.slot_minute === null || !row.timezone) {
    return { reason: 'unavailable' };
  }

  const saved = row.next_call_at && row.next_call_at > now ? row.next_call_at : undefined;
  const at = saved ?? nextSlotAfter(now, { weekday: row.slot_weekday, minute: row.slot_minute, timezone: row.timezone });
  if (row.billing_status === 'trialing') {
    if (row.trial_ends_at && row.trial_ends_at <= at) return { reason: 'trial_ends' };
  } else if (!['comped', 'active', 'past_due'].includes(row.billing_status)) {
    return { reason: 'unavailable' };
  }
  if (row.cancel_at_period_end && (!row.paid_until || row.paid_until <= at)) {
    return { reason: 'paid_period_ends' };
  }
  return { at, keepCycle: !!saved };
}
