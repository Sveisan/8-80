import type { WeeklyOffer } from '../weekly/intro-pilot.ts';
import type postgres from 'postgres';
import type { StoredSkipUndo } from '../schedule/scheduler.ts';
import { resumeAppointment, type ResumeSchedule } from '../schedule/resume.ts';

export interface AccountState {
  paused: boolean;
  stoppedByText?: boolean;
  voice?: string;
  nudgesEnabled?: boolean;
  calendarInvitesEnabled?: boolean;
  googleCalendarInvites?: boolean;
  onHold?: boolean;
  billing: string;
  weeklyOffer?: WeeklyOffer;
  weeklyFreeCallsUsed?: number;
  canCall: boolean;
  trialEnds?: Date;
  next?: Date;
  resumeAt?: Date;
  /** Stored occurrence, including an expired or ineligible one, for stale-form checks. */
  scheduledAt?: Date;
  skipUndo?: StoredSkipUndo;
  subscribed?: boolean;
  feedbackOptOut?: boolean;
  cancelAtPeriodEnd?: boolean;
  paidUntil?: Date;
}

/** One snapshot of the conditions the scheduler uses, including the trial boundary. */
export async function accountState(sql: postgres.Sql, hash: string, now = new Date()): Promise<AccountState | undefined> {
  const [row] = await sql<(ResumeSchedule & { paused: boolean; weekly_offer: WeeklyOffer | null; weekly_free_calls_used: number; web_skip_undo: StoredSkipUndo | null; ls_subscription_id: string | null; feedback_opt_out: boolean; voice: string | null; nudges_enabled: boolean; calendar_invites_enabled: boolean; google_calendar: boolean })[]>`
    select paused, all_calls_stopped, weekly_offer, weekly_free_calls_used, billing_status, trial_ends_at, next_call_at, slot_weekday, slot_minute, timezone, web_skip_undo, ls_subscription_id, cancel_at_period_end, paid_until, feedback_opt_out, held_for_review, voice, nudges_enabled, calendar_invites_enabled,
      exists(select 1 from calendar_invitations i where i.phone_hash=callers.phone_hash and i.provider='google' and i.state='active') as google_calendar
      from callers where phone_hash = ${hash}
  `;
  if (!row) return undefined;
  const trial = row.billing_status === 'trialing';
  const endedTrial = row.billing_status === 'ended' && !!row.trial_ends_at && row.trial_ends_at <= now && !row.ls_subscription_id;
  const entitled = ['comped', 'active', 'past_due'].includes(row.billing_status) || (trial && (!row.trial_ends_at || row.trial_ends_at > now));
  const canCall = entitled && (!row.cancel_at_period_end || (!!row.paid_until && row.paid_until > now));
  const next = row.next_call_at;
  const paused = row.paused || row.all_calls_stopped;
  const resume = paused && canCall ? resumeAppointment(row, now) : undefined;
  const available = (at: Date) => canCall && !paused && !row.held_for_review && at > now
    && (!row.cancel_at_period_end || (!!row.paid_until && at < row.paid_until))
    && (!trial || !row.trial_ends_at || at < row.trial_ends_at);
  const undo = row.web_skip_undo;
  return {
    voice: row.voice ?? undefined, nudgesEnabled: row.nudges_enabled,
    calendarInvitesEnabled: row.calendar_invites_enabled,
    ...(row.google_calendar ? {googleCalendarInvites:true} : {}),
    feedbackOptOut: row.feedback_opt_out, subscribed: !!row.ls_subscription_id, cancelAtPeriodEnd: row.cancel_at_period_end, ...(row.paid_until ? { paidUntil: row.paid_until } : {}),
    onHold: row.held_for_review, paused, stoppedByText: row.all_calls_stopped,
    billing: endedTrial ? 'trial_ended' : row.billing_status, canCall,
    ...(row.weekly_offer ? { weeklyOffer: row.weekly_offer, weeklyFreeCallsUsed: row.weekly_free_calls_used } : {}),
    ...(next ? { scheduledAt: next } : {}),
    ...((trial || endedTrial) && row.trial_ends_at ? { trialEnds: row.trial_ends_at } : {}),
    ...(next && available(next) ? { next } : {}),
    ...(resume ? { resumeAt: resume.at } : {}),
    ...(undo && next?.toISOString() === undo.replacementAt && available(new Date(undo.skippedAt)) ? { skipUndo: undo } : {}),
  };
}

/** Enough to recognise the delivery address without exposing it in markup. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  const suffix = domain.includes('.') ? domain.slice(domain.lastIndexOf('.')) : '';
  return `${local[0]}•••@${domain[0]}•••${suffix}`;
}
