import type { Database } from '../store/transaction.ts';
export type Milestone = 'phone_verified' | 'onboarding_complete' | 'action_read_back' | 'trial_ended' | 'paid';
export async function milestone(sql: Database, phoneHash: string, event: Milestone, identity: string, at = new Date()): Promise<void> {
  await sql`insert into journey_events (id, phone_hash, event, at) values (${`${event}:${identity}`}, ${phoneHash}, ${event}, ${at}) on conflict do nothing`;
}
export async function countRequest(sql: Database, event: 'booking_view' | 'booking_submitted' | 'controls_loaded' | 'control_submitted' | 'control_applied' | 'control_not_applied', now = new Date()): Promise<void> {
  await sql`insert into journey_counts (day, event, count) values (${now.toISOString().slice(0,10)}, ${event}, 1)
    on conflict (day, event) do update set count = journey_counts.count + 1`;
}
export async function pruneJourney(sql: Database, now = new Date()): Promise<void> {
  const before = new Date(+now - 60 * 86400_000);
  await sql`delete from journey_events where at < ${before}`;
  await sql`delete from journey_counts where day < ${before.toISOString().slice(0,10)}`;
}

/** A retained-data baseline, not an attributed visitor-conversion funnel. */
export async function journeyReport(sql: Database, now = new Date()) {
  const since = new Date(+now - 30 * 86400_000);
  const requests = await sql`select event, sum(count)::int as requests from journey_counts where day >= ${since.toISOString().slice(0,10)} and day <= ${now.toISOString().slice(0,10)} group by event order by event`;
  const milestones = await sql`select event, count(*)::int as events, count(distinct phone_hash)::int as accounts from journey_events where at >= ${since} and at <= ${now} group by event order by event`;
  const calls = await sql`select status, count(*)::int as attempts from call_attempts where scheduled_for >= ${since} and scheduled_for <= ${now} group by status order by status`;
  const messages = await sql`select kind, channel, status, count(*)::int as messages from message_outbox where created_at >= ${since} and created_at <= ${now} group by kind, channel, status order by kind, channel, status`;
  const [cohort] = await sql`with people as (
    select v.phone_hash, min(v.at) as verified_at from journey_events v where v.event = 'phone_verified' and v.at >= ${since} and v.at <= ${now} group by v.phone_hash
  ), actions as (
    select p.phone_hash, p.verified_at, min(e.at) as first_action, count(e.id)::int as action_calls from people p
    left join journey_events e on e.phone_hash = p.phone_hash and e.event = 'action_read_back' and e.at >= p.verified_at and e.at <= ${now} and e.at < p.verified_at + interval '30 days'
    group by p.phone_hash, p.verified_at
  ) select count(*)::int as verified_accounts, count(first_action)::int as accounts_with_action_read_back,
    count(*) filter (where action_calls > 1)::int as accounts_with_repeat_action_read_back,
    percentile_cont(0.5) within group (order by extract(epoch from first_action - verified_at)) as median_seconds_to_action_read_back
    from actions`;
  return { from:since.toISOString(), through:now.toISOString(), requests, milestones, calls, messages, cohort,
    interpretation:'Request counts are not unique people. Read-back markers are observable proxies, not validated activation or memory accuracy. Recent cohorts have not had a full month. Deleted accounts and expired records are absent.' };
}
