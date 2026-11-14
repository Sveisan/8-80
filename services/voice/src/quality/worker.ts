import postgres from 'postgres';
import { decrypt } from '../store/crypto.ts';
import { toTranscript } from '../webhook/speechify.ts';
import { weeklyQuality } from './weekly.ts';
import { reviewWithJev, JEV_POLICY, type JevReviewInput } from './jev.ts';

const DAY = 86_400_000;
export interface WorkerConfig { enabled: boolean; apiKey?: string; startedAt?: Date; }
export interface WorkerResult { status: 'disabled' | 'unavailable' | 'ready'; processed: number; reviewed: number; unavailable: number; }
export function workerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const value = env['JEV_REVIEW_STARTED_AT'] ?? '';
  const at = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) ? new Date(value) : undefined;
  return { enabled: env['JEV_REVIEW_ENABLED'] === '1', apiKey: env['TYPESAFE_API_KEY'],
    ...(at && Number.isFinite(+at) ? { startedAt: at } : {}) };
}
const unavailable = (reason: string) => ({ advisoryOnly: true, policy: JEV_POLICY, status: 'unavailable', reason });
export async function pruneQualityReviews(sql: postgres.Sql, now = new Date()): Promise<number> {
  const rows = await sql`delete from jev_quality_reviews where expires_at <= ${now} returning attempt_id`;
  return rows.length;
}

/** Separate worker only. It never runs inside settlement, delivery or a call tick.
 * Claim before I/O, never retry a claimed call after a crash, keep only scores.
 * The activation timestamp prevents retroactive export of old calls. */
export async function reviewCompletedCalls(sql: postgres.Sql, settings: WorkerConfig, now = new Date(),
  reviewer: typeof reviewWithJev = reviewWithJev): Promise<WorkerResult> {
  const result: WorkerResult = { status: 'ready', processed: 0, reviewed: 0, unavailable: 0 };
  if (!settings.enabled) return { ...result, status: 'disabled' };
  if (!settings.apiKey?.trim() || !settings.startedAt || !Number.isFinite(+settings.startedAt)) return { ...result, status: 'unavailable' };
  await pruneQualityReviews(sql, now);
  const interrupted = JSON.stringify({ jev: unavailable('interrupted_worker'), recapScope: 'unavailable' });
  await sql`update jev_quality_reviews set state = 'unavailable', finished_at = ${now}, report = ${interrupted}, recap_enc = null
    where state = 'running' and started_at < ${new Date(+now - 5 * 60_000)}`;
  const rows = await sql<{ id: string; phone_hash: string; provider_call_id: string; ended_at: Date }[]>`
    select a.id, a.phone_hash, a.provider_call_id, a.ended_at from call_attempts a
    join callers c on c.phone_hash = a.phone_hash
    left join belief_sessions b on b.id = a.id left join unblock_sessions u on u.id = a.id
    where a.status = 'completed' and a.safety_tier is null and b.id is null and u.id is null
      and a.provider_call_id is not null and a.ended_at >= ${settings.startedAt}
      and a.ended_at > ${new Date(+now - 14 * DAY)} and a.ended_at <= ${new Date(+now - 30_000)}
      and (select count(*) from call_attempts x where x.provider_call_id = a.provider_call_id) = 1
      and not exists (select 1 from jev_quality_reviews q where q.attempt_id = a.id and q.state <> 'queued')
    order by a.ended_at, a.id limit 5`;
  for (const row of rows) {
    const claimed = await sql<{ recap_enc: string | null }[]>`insert into jev_quality_reviews (attempt_id, phone_hash, started_at, expires_at, state)
      select ${row.id}, ${row.phone_hash}, ${now}, ${new Date(+row.ended_at + 14 * DAY)}, 'running'
      where exists (select 1 from callers where phone_hash = ${row.phone_hash})
      on conflict (attempt_id) do update set state = 'running', started_at = ${now}
      where jev_quality_reviews.state = 'queued' returning recap_enc`;
    if (!claimed.length) continue;
    result.processed++;
    let report: object;
    let state = 'unavailable';
    try {
      const [source] = await sql<{ body_enc: string | null }[]>`
        select (select d.body_enc from webhook_deliveries d where d.conversation_id = a.provider_call_id
          and d.event = 'conversation.completed' order by d.received_at desc limit 1) as body_enc
        from call_attempts a join callers c on c.phone_hash = a.phone_hash where a.id = ${row.id}`;
      if (!source?.body_enc) throw Error('source_unavailable');
      const transcript = toTranscript(JSON.parse(decrypt(source.body_enc)) as unknown);
      if (transcript.providerCallId !== row.provider_call_id) throw Error('source_unavailable');
      const candidateRecap = claimed[0]?.recap_enc ? decrypt(claimed[0].recap_enc) : undefined;
      const input: JevReviewInput = { conversation: transcript.turns, ...(candidateRecap ? { candidateRecap } : {}), trustedContext: {} };
      const jev = await reviewer(input, { enabled: true, apiKey: settings.apiKey });
      state = jev.status === 'reviewed' ? 'reviewed' : 'unavailable';
      report = { existingChecks: weeklyQuality(transcript), jev, recapScope: candidateRecap ? 'conversation_parts_only' : 'unavailable' };
    } catch { report = { jev: unavailable('source_unavailable'), recapScope: 'unavailable' }; }
    await sql`update jev_quality_reviews set state = ${state}, report = ${JSON.stringify(report)}, finished_at = ${now}, recap_enc = null
      where attempt_id = ${row.id} and state = 'running'`;
    if (state === 'reviewed') result.reviewed++; else result.unavailable++;
  }
  return result;
}

/** One small DB pool, one active batch; not awaited by any HTTP request. */
export function startQualityWorker(url: string, emit: (result: WorkerResult) => void,
  settings = workerConfig()): () => Promise<void> {
  if (!settings.enabled) return async () => {};
  let sql: postgres.Sql;
  try { sql = postgres(url, { max: 1, connect_timeout: 3, idle_timeout: 5, connection: { statement_timeout: 5000 } }); }
  catch { emit({ status: 'unavailable', processed: 0, reviewed: 0, unavailable: 0 }); return async () => {}; }
  let active: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (stopped || active) return;
    active = reviewCompletedCalls(sql, settings).then(emit)
      .catch(() => emit({ status: 'unavailable', processed: 0, reviewed: 0, unavailable: 0 }))
      .finally(() => { active = undefined; });
  };
  const timer = setInterval(run, 60_000); timer.unref(); run();
  return async () => { stopped = true; clearInterval(timer); await active; await sql.end({ timeout: 5 }); };
}
