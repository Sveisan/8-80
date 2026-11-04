import { createHash } from 'node:crypto';
import type { Database } from '../store/transaction.ts';
import type { ScriptLines } from '../script.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { femaleVoiceReady, sameMessageNumber } from '../agent/voices.ts';

export const EXPERIMENT = 'weekly-tips-v1';
export type Arm = 'A' | 'B';
/** Editorial scores, not measured customer preferences. Only scores strictly above 7 ship. */
export const CANDIDATES = [
  ['01', 'help', 8], ['02', 'help', 8], ['03', 'directness', 7], ['04', 'think', 9],
  ['05', 'pace', 8], ['06', 'pace', 9], ['07', 'shorter', 9], ['08', 'no_action', 10],
  ['09', 'memory', 10], ['10', 'followup', 7], ['11', 'voice', 9], ['12', 'schedule', 10],
  ['13', 'nudges', 8], ['14', 'reminder', 9], ['15', 'time_question', 7], ['16', 'recurring', 4],
  ['17', 'calendar', 3], ['18', 'extra_call', 3], ['19', 'reminder_control', 10], ['20', 'tips_control', 10],
] as const;
const SEQUENCES: Record<Arm, readonly string[]> = {
  A: ['help', 'voice', 'schedule', 'nudges', 'reminder', 'think', 'pace', 'shorter', 'no_action', 'memory', 'followup', 'reminder_control', 'tips_control'],
  B: ['help', 'reminder', 'schedule', 'memory', 'no_action', 'voice', 'think', 'shorter', 'pace', 'nudges', 'followup', 'reminder_control', 'tips_control'],
};
export const randomizedArm = (hash: string): Arm => createHash('sha256').update(`${EXPERIMENT}:${hash}`).digest()[0]! % 2 ? 'B' : 'A';
interface Progress { arm?: Arm; topics?: string[]; last?: string; }
async function consumeTopic(sql: Database, hash: string, topic: string, at?: Date): Promise<void> {
  const [caller]=await sql`select tip_progress from callers where phone_hash=${hash}`;
  if(!caller)return;
  const progress=JSON.parse(caller['tip_progress']) as Progress;
  progress.topics=[...new Set([...(progress.topics??[]),topic])];
  if(at)progress.last=at.toISOString();
  await sql`update callers set tip_progress=${JSON.stringify(progress)} where phone_hash=${hash}`;
}
export { consumeTopic };

export async function nextTip(sql: Database, hash: string, attemptId: string, script: ScriptLines, now: Date, smsAvailable=true) {
  const [caller] = await sql`select tips_enabled, onboarding, timezone,tip_progress from callers where phone_hash=${hash}`;
  if (!caller?.['tips_enabled'] || !['complete', 'legacy'].includes(caller['onboarding'])) return null;
  const [existing] = await sql`select * from weekly_tip_offers where attempt_id=${attemptId}`;
  if(existing && (existing['reported_at'] || existing['exposed_at'] || existing['response']))return null;
  const progress=JSON.parse(caller['tip_progress']) as Progress;
  const seen = await sql`select topic, exposed_at from weekly_tip_offers where phone_hash=${hash} and (exposed_at is not null or response='declined')`;
  if (!existing && (progress.last && +now-+new Date(progress.last)<6*86400_000 || seen.some(r => r['exposed_at'] && +now - +r['exposed_at'] < 6 * 86400_000))) return null;
  const available = (topic: string) => (topic !== 'voice' || femaleVoiceReady())
    && (!['nudges', 'reminder', 'reminder_control'].includes(topic) || smsAvailable && sameMessageNumber())
    && (!['voice', 'schedule', 'nudges', 'memory'].includes(topic) || !!process.env['PUBLIC_URL']);
  if (existing) return available(existing['topic']) ? { id: existing['tip_id'], text: decrypt(existing['wording_enc']) } : null;
  const [experiment] = await sql`select winner from weekly_tip_experiments where id=${EXPERIMENT}`;
  const winner = experiment?.['winner'];
  const arm = progress.arm ?? (winner === 'A' || winner === 'B' ? winner : randomizedArm(hash));
  const [prior] = await sql`select arm from weekly_tip_assignments where phone_hash=${hash}`;
  if (!prior) {
    const [counter] = await sql`insert into weekly_tip_counters(id,count) values(${`${EXPERIMENT}:${arm}`},1)
      on conflict(id) do update set count=weekly_tip_counters.count+1 returning count`;
    await sql`insert into weekly_tip_assignments(phone_hash,experiment,arm,randomized,sample_rank,assigned_at)
      values(${hash},${EXPERIMENT},${arm},${!winner&&!progress.arm},${counter!['count']},${now})`;
    await sql`update callers set tip_progress=${JSON.stringify({...progress,arm})} where phone_hash=${hash}`;
  }
  const [assignment] = await sql`select arm from weekly_tip_assignments where phone_hash=${hash}`;
  const assigned = assignment!['arm'] as Arm;
  const topic = SEQUENCES[assigned].find(topic => available(topic) && CANDIDATES.some(c => c[1]===topic && c[2]>7) && !progress.topics?.includes(topic) && !seen.some(r => r['topic'] === topic));
  const choices = CANDIDATES.filter(c => c[1] === topic && c[2] > 7 && script.has(`tips.${c[0]}`));
  const chosen = choices[assigned === 'A' ? 0 : choices.length - 1];
  if (!chosen) return null;
  const id = `tips.${chosen[0]}`; const text = script.get(id)!;
  await sql`insert into weekly_tip_offers(attempt_id,phone_hash,tip_id,topic,wording_enc,offered_at)
    values(${attemptId},${hash},${id},${chosen[1]},${encrypt(text)},${now}) on conflict do nothing`;
  return { id, text };
}

/** A server offer or agent tool receipt is not evidence that the words were spoken. */
export async function observeTip(sql: Database, attemptId: string, agentTurns: string[], now: Date): Promise<void> {
  const [offer] = await sql`select phone_hash,topic,wording_enc from weekly_tip_offers where attempt_id=${attemptId} and exposed_at is null`;
  const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (offer && agentTurns.some(t => normalized(t).includes(normalized(decrypt(offer['wording_enc']))))) {
    await sql`update weekly_tip_offers set exposed_at=${now} where attempt_id=${attemptId} and exposed_at is null`;
    await consumeTopic(sql,offer['phone_hash'],offer['topic'],now);
  }
}

/** Conservative fixed-sample comparison. Evaluate once, after both first 100 accounts mature. */
export function interval(successes: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96, p = successes / n, denominator = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [centre - half, centre + half];
}
export interface ExperimentGroup {arm:Arm;n:number;mature:number;returned:number;opted_out:number;exposed:number;}
export function chooseWinner(groups: ExperimentGroup[]): Arm|null {
  if(groups.length!==2 || groups.some(g=>g.n!==100 || g.mature!==100 || g.exposed<50))return null;
  const a=groups.find(g=>g.arm==='A'),b=groups.find(g=>g.arm==='B');if(!a||!b)return null;
  if(interval(a.returned,100)[0]>interval(b.returned,100)[1] && a.returned-b.returned>=5 && a.opted_out<=b.opted_out)return 'A';
  if(interval(b.returned,100)[0]>interval(a.returned,100)[1] && b.returned-a.returned>=5 && b.opted_out<=a.opted_out)return 'B';
  return null;
}
async function experimentGroups(sql: Database, now: Date): Promise<ExperimentGroup[]> {
  return await sql<ExperimentGroup[]>`with sample as (
    select * from weekly_tip_assignments where experiment=${EXPERIMENT} and randomized=true and sample_rank<=100
  )
  select arm,count(*)::int as n,count(*) filter(where assigned_at<=${new Date(+now-14*86400_000)})::int as mature,
    count(*) filter(where exists(select 1 from weekly_tip_offers o where o.phone_hash=s.phone_hash and o.exposed_at>=s.assigned_at and o.exposed_at<s.assigned_at+interval '336 hours'))::int as exposed,
    count(*) filter(where exists(select 1 from journey_events e where e.phone_hash=s.phone_hash
      and e.event='conversation_completed' and e.at>s.assigned_at+interval '24 hours' and e.at<s.assigned_at+interval '336 hours'))::int as returned,
    count(*) filter(where opted_out_at>=assigned_at and opted_out_at<assigned_at+interval '336 hours')::int as opted_out
    from sample s group by arm order by arm`;
}
export async function tipReport(sql: Database, now = new Date()) {
  const groups=await experimentGroups(sql,now);
  const frozen = (await sql<{evaluated_at:Date;winner:Arm|null;results:string}[]>`select evaluated_at,winner,results from weekly_tip_experiments where id=${EXPERIMENT}`)[0];
  const exposures = await sql`select a.arm,count(*)::int as offers,count(o.reported_at)::int as agent_reports,count(o.exposed_at)::int as transcript_exposures,
    count(*) filter(where o.response='accepted')::int as reported_accepted,count(*) filter(where o.response='declined')::int as reported_declined
    from weekly_tip_offers o join weekly_tip_assignments a on a.phone_hash=o.phone_hash group by a.arm order by a.arm`;
  const reminders=await sql`select a.arm,m.status,count(*)::int as intents from message_outbox m join weekly_tip_assignments a on a.phone_hash=m.phone_hash
    where m.kind='reminder' group by a.arm,m.status order by a.arm,m.status`;
  return { experiment: EXPERIMENT, groups, exposures, reminders, frozen: frozen ? { ...frozen, results: JSON.parse(frozen['results']) } : null,
    definition: 'First 100 randomized accounts per arm, 14 elapsed days. Primary: backend-completed weekly conversation from 24 hours to 14 days after assignment. Includes retained stopped/paused users. No-action calls count. Tool responses and transcript exposure are separate diagnostics.',
    limitations: 'Editorial scores are not experiment results. Return is an operational proxy, not usefulness. Deleted accounts and data older than 60 days are absent. No attribution to individual phrases or claims of uplift.' };
}
export async function optimizeTips(sql: Database, now = new Date()): Promise<void> {
  if((await sql`select id from weekly_tip_experiments where id=${EXPERIMENT}`).length)return;
  const groups=await experimentGroups(sql,now);
  if(groups.length!==2 || groups.some(g=>g.n!==100 || g.mature!==100))return;
  const winner=chooseWinner(groups);
  await sql`insert into weekly_tip_experiments(id,evaluated_at,winner,results) values(${EXPERIMENT},${now},${winner},${JSON.stringify(groups)}) on conflict do nothing`;
}
