import type postgres from 'postgres';

export interface AccountState {
  paused: boolean;
  billing: string;
  canCall: boolean;
  trialEnds?: Date;
  next?: Date;
  subscribed?: boolean;
  feedbackOptOut?: boolean;
  cancelAtPeriodEnd?: boolean;
  paidUntil?: Date;
}

/** One snapshot of the conditions the scheduler uses, including the trial boundary. */
export async function accountState(sql: postgres.Sql, hash: string, now = new Date()): Promise<AccountState | undefined> {
  const [row] = await sql<{ paused: boolean; billing_status: string; trial_ends_at: Date | null; next_call_at: Date | null; ls_subscription_id: string | null; cancel_at_period_end: boolean; paid_until: Date | null; feedback_opt_out: boolean }[]>`
    select paused, billing_status, trial_ends_at, next_call_at, ls_subscription_id, cancel_at_period_end, paid_until, feedback_opt_out from callers where phone_hash = ${hash}
  `;
  if (!row) return undefined;
  const trial = row.billing_status === 'trialing';
  const endedTrial = row.billing_status === 'ended' && !!row.trial_ends_at && row.trial_ends_at <= now && !row.ls_subscription_id;
  const entitled = ['comped', 'active', 'past_due'].includes(row.billing_status) || (trial && (!row.trial_ends_at || row.trial_ends_at > now));
  const canCall = entitled && (!row.cancel_at_period_end || (!!row.paid_until && row.paid_until > now));
  const next = row.next_call_at;
  return {
    feedbackOptOut: row.feedback_opt_out, subscribed: !!row.ls_subscription_id, cancelAtPeriodEnd: row.cancel_at_period_end, ...(row.paid_until ? { paidUntil: row.paid_until } : {}),
    paused: row.paused, billing: endedTrial ? 'trial_ended' : row.billing_status, canCall,
    ...((trial || endedTrial) && row.trial_ends_at ? { trialEnds: row.trial_ends_at } : {}),
    ...(canCall && !row.paused && next && next > now && (!row.cancel_at_period_end || (!!row.paid_until && next < row.paid_until)) && (!trial || !row.trial_ends_at || next < row.trial_ends_at) ? { next } : {}),
  };
}

/** Enough to recognise the delivery address without exposing it in markup. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '•••';
  const suffix = domain.includes('.') ? domain.slice(domain.lastIndexOf('.')) : '';
  return `${local[0]}•••@${domain[0]}•••${suffix}`;
}
