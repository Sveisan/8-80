import type { Database } from '../store/transaction.ts';
export type Milestone = 'phone_verified' | 'onboarding_complete' | 'action_read_back' | 'conversation_completed' | 'trial_ended' | 'paid';
export async function milestone(sql: Database, phoneHash: string, event: Milestone, identity: string, at = new Date(), cycleKey?: string): Promise<void> {
  await sql`insert into journey_events (id, phone_hash, event, at, cycle_key) values (${`${event}:${identity}`}, ${phoneHash}, ${event}, ${at}, ${cycleKey ?? null}) on conflict do nothing`;
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
    left join journey_events e on e.phone_hash = p.phone_hash and e.event = 'action_read_back' and e.at >= p.verified_at and e.at <= ${now} and e.at < p.verified_at + interval '720 hours'
    group by p.phone_hash, p.verified_at
  ) select count(*)::int as verified_accounts, count(first_action)::int as accounts_with_action_read_back,
    count(*) filter (where action_calls > 1)::int as accounts_with_repeat_action_read_back,
    percentile_cont(0.5) within group (order by extract(epoch from first_action - verified_at)) as median_seconds_to_action_read_back
    from actions`;
  const retention = await retentionReport(sql, now);
  return { retention, from:since.toISOString(), through:now.toISOString(), requests, milestones, calls, messages, cohort,
    interpretation:'Request counts are not unique people. Read-back markers are observable proxies, not validated activation or memory accuracy. Recent cohorts have not had a full month. Deleted accounts and expired records are absent.' };
}


/** Completed first-month cohorts only; callbacks share their original cycle. */
export async function retentionReport(sql: Database, now = new Date()) {
  const oldest = new Date(+now - 60 * 86400_000);
  const mature = new Date(+now - 30 * 86400_000);
  const [tracking] = await sql<{ started_at: Date }[]>`
    select started_at from journey_tracking where event = 'conversation_completed'`;
  const started = tracking?.started_at ?? now;
  const [population] = await sql<{ immature_accounts: number; mature_accounts_without_full_tracking: number }[]>`with people as (
    select phone_hash, min(at) as verified_at from journey_events
    where event = 'phone_verified' and at >= ${oldest} and at <= ${now} group by phone_hash
  ) select count(*) filter (where verified_at > ${mature})::int as immature_accounts,
      count(*) filter (where verified_at <= ${mature} and verified_at < ${started})::int as mature_accounts_without_full_tracking
    from people`;
  const [cohort] = await sql<{
    verified_accounts: number;
    accounts_with_repeat_conversations: number;
    accounts_with_three_cycles: number;
    accounts_with_late_month_return: number;
  }[]>`with people as (
    select phone_hash, min(at) as verified_at from journey_events
    where event = 'phone_verified' and at >= ${oldest} and at <= ${mature} and at >= ${started}
    group by phone_hash
  ), cycles as (
    select p.phone_hash, p.verified_at, e.cycle_key, min(e.at) as completed_at
    from people p join journey_events e on e.phone_hash = p.phone_hash
      and e.event = 'conversation_completed' and e.cycle_key is not null
      and e.at >= p.verified_at and e.at < p.verified_at + interval '720 hours'
    group by p.phone_hash, p.verified_at, e.cycle_key
  ), engagement as (
    select p.phone_hash, count(c.cycle_key)::int as cycles,
      coalesce(bool_or(c.completed_at >= p.verified_at + interval '504 hours'), false) as late_return
    from people p left join cycles c on c.phone_hash = p.phone_hash group by p.phone_hash
  ) select count(*)::int as verified_accounts,
      count(*) filter (where cycles >= 2)::int as accounts_with_repeat_conversations,
      count(*) filter (where cycles >= 3)::int as accounts_with_three_cycles,
      count(*) filter (where cycles >= 2 and late_return)::int as accounts_with_late_month_return
    from engagement`;
  const total = Number(cohort?.['verified_accounts'] ?? 0);
  const returning = Number(cohort?.['accounts_with_late_month_return'] ?? 0);
  return {
    tracking_started_at: tracking ? started.toISOString() : null,
    verified_from: oldest.toISOString(), verified_through: mature.toISOString(),
    ...population, ...cohort,
    late_month_return_rate: total ? returning / total : null,
    definition: 'Backend-completed conversations after introduction completion, including no-action calls. At least two distinct scheduled cycles, with the first completion of one cycle at 21 to less than 30 elapsed days. Callbacks continue the original cycle. This is an operational proxy, not validated usefulness or memory accuracy.',
    limitations: 'Only accounts verified after tracking began and with a complete 30-day window enter the mature cohort. Paused and stopped retained accounts stay in the denominator. Deleted accounts and events older than 60 days are absent; the report is not a complete historical population. No legacy conversations are backfilled.',
  };
}
