import type postgres from 'postgres';
import { JEV_MODEL, JEV_POLICY } from './jev.ts';

export const FILTERS = ['all', 'flagged', 'uncertain', 'unavailable', 'clear', 'pending'] as const;
export type Filter = typeof FILTERS[number];
export type Check = { state: 'flag' | 'clear' | 'uncertain' | 'unavailable'; score?: number };
export interface CallReview {
  id: string; endedAt: Date; reviewedAt?: Date;
  state: 'reviewed' | 'unavailable' | 'pending' | 'not_reviewed';
  repeated: Check; recap: Check; note?: string;
}
export interface ReviewRow { id: string; ended_at: Date; claimed_at: Date; state: string | null; report: string | null; finished_at: Date | null; }
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const missing = (): Check => ({ state: 'unavailable' });
function check(value: unknown): Check {
  const v = object(value), p = v['probability'];
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return missing();
  const expected = p >= JEV_POLICY.flagMin ? 'flag' : p <= JEV_POLICY.clearMax ? 'clear' : 'uncertain';
  return v['state'] === expected ? { state: expected, score: p } : missing();
}
const reasons: Record<string, string> = {
  timeout: 'The reviewer timed out.', provider_error: 'The reviewer was unavailable.',
  source_unavailable: 'The retained call source was unavailable.', interrupted: 'The review was interrupted.',
  payload_too_large: 'The call exceeded the review size limit.', no_recap: 'No conversational recap was available.',
};
/** Project only known score fields; never render arbitrary model output or queued text. */
export function projectReview(row: ReviewRow, startedAt?: Date): CallReview {
  const call: CallReview = { id: row.id, endedAt: row.ended_at,
    state: 'unavailable', repeated: missing(), recap: missing(),
    ...(row.finished_at ? { reviewedAt: row.finished_at } : {}) };
  if (!row.state) {
    const eligible = startedAt && row.claimed_at >= startedAt && row.ended_at >= startedAt;
    return { ...call, state: eligible ? 'pending' : 'not_reviewed',
      note: eligible ? 'Waiting for the background reviewer.' : 'Outside the activated review window.' };
  }
  if (row.state === 'queued' || row.state === 'running') return { ...call, state: 'pending', note: row.state === 'running' ? 'Review in progress.' : 'Waiting for the background reviewer.' };
  let report: Record<string, unknown>;
  try { report = object(JSON.parse(row.report ?? '')); } catch { return { ...call, note: 'Review data was unavailable.' }; }
  const jev = object(report['jev']);
  if (row.state !== 'reviewed' || jev['status'] !== 'reviewed' || jev['model'] !== JEV_MODEL) {
    return { ...call, note: reasons[String(jev['reason'])] ?? 'The review could not be completed.' };
  }
  return { ...call, state: 'reviewed', repeated: check(jev['repeatedQuestion']), recap: check(jev['unsupportedRecap']),
    ...(object(jev['unsupportedRecap'])['reason'] === 'no_recap' ? { note: reasons['no_recap'] } : {}) };
}
export function matches(call: CallReview, filter: Filter): boolean {
  const states = [call.repeated.state, call.recap.state];
  if (filter === 'all') return true;
  if (filter === 'pending') return call.state === 'pending';
  if (filter === 'flagged') return states.includes('flag');
  if (filter === 'uncertain') return states.includes('uncertain');
  if (filter === 'clear') return call.state === 'reviewed' && states.every(s => s === 'clear');
  return call.state === 'unavailable' || call.state === 'not_reviewed' || call.state === 'reviewed' && states.includes('unavailable');
}
/** Explicit bounded window. No caller identity, transcript, webhook or encrypted recap is selected. */
export async function recentReviews(sql: postgres.Sql, now: Date, startedAt?: Date): Promise<CallReview[]> {
  const rows = await sql<ReviewRow[]>`
    select a.id, a.ended_at, a.claimed_at, q.state, left(q.report, 16384) as report, q.finished_at
    from call_attempts a
    left join jev_quality_reviews q on q.attempt_id = a.id and q.expires_at > ${now}
    where a.status = 'completed' and a.safety_tier is null and a.ended_at <= ${now} and a.ended_at > ${new Date(+now - 14 * 86_400_000)}
      and not exists (select 1 from belief_sessions b where b.id = a.id)
      and not exists (select 1 from unblock_sessions u where u.id = a.id)
    order by a.ended_at desc, a.id desc limit 500`;
  return rows.map(row => projectReview(row, startedAt));
}
