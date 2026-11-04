import type { Database } from '../store/transaction.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { enqueue } from '../messages/outbox.ts';
import { decrypt } from '../store/crypto.ts';
import { sameMessageNumber } from '../agent/voices.ts';
import { zonedTimeToUtc } from '../schedule/time.ts';

export class WeeklyToolError extends Error {
  constructor(readonly code: string) { super(code); }
}
const MINUTE=60_000;
export const entitled = (c: Record<string, unknown>, now: Date) => ['comped','active','past_due'].includes(String(c['billing_status']))
  || (c['billing_status']==='trialing' && (!c['trial_ends_at'] || +(c['trial_ends_at'] as Date)>+now));
export function canRemind(c: Record<string, unknown>, now: Date): boolean {
  return sameMessageNumber() && !c['paused'] && !c['all_calls_stopped'] && !c['sms_opt_out'] && !c['held_for_review']
    && entitled(c,now) && (!c['cancel_at_period_end'] || !!c['paid_until'] && +(c['paid_until'] as Date)>+now);
}
/** Reject nonexistent and ambiguous wall-clock times; never silently move an agreement. */
export function reminderTime(date: string, time: string, zone: string, now: Date): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new WeeklyToolError('date_and_time_required');
  const [year,month,day]=date.split('-').map(Number) as [number,number,number];
  const [hour,minute]=time.split(':').map(Number) as [number,number];
  let at: Date;
  let format: Intl.DateTimeFormat;
  try { format = new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}); }
  catch { throw new WeeklyToolError('timezone_required'); }
  const wall = (d:Date) => format.format(d).replace(',','');
  try { at=zonedTimeToUtc(year,month,day,hour*60+minute,zone); } catch { throw new WeeklyToolError('timezone_required'); }
  if (wall(at)!==`${date} ${time}`) throw new WeeklyToolError('nonexistent_local_time');
  if ([-120,-90,-60,-30,30,60,90,120].some(m=>wall(new Date(+at+m*MINUTE))===wall(at))) throw new WeeklyToolError('ambiguous_local_time_choose_another');
  if (+at<+now+2*MINUTE || +at>+now+30*86400_000) throw new WeeklyToolError('choose_time_two_minutes_to_thirty_days_ahead');
  return at;
}
export async function reminderView(sql: Database, hash: string) {
  const [row]=await sql`select r.revision,r.body_enc,r.due_at,r.timezone,r.state,m.status as dispatch_state from weekly_reminders r
    left join message_outbox m on m.event_key='reminder:'||r.phone_hash||':'||r.revision::text where r.phone_hash=${hash}`;
  const state=row?.['state']==='queued' && ['sending','uncertain'].includes(row['dispatch_state']) ? row['dispatch_state'] : row?.['state'];
  if(!row)return null;
  const local=new Intl.DateTimeFormat('sv-SE',{timeZone:row['timezone'],year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(row['due_at']).replace(',','').split(' ');
  return {revision:row['revision'],text:row['body_enc']?decrypt(row['body_enc']):null,at:row['due_at'].toISOString(),timezone:row['timezone'],local_date:local[0],local_time:local[1],state};
}
export async function invalidateReminder(sql: Database, hash: string): Promise<void> {
  await sql`update message_outbox set status='suppressed',reason='reminder_changed',payload_enc=null,recipient_enc=null
    where phone_hash=${hash} and kind='reminder' and status='pending'`;
}
/** No provider I/O: caller lock plus a unique revision prevent duplicate intent. */
export async function queueDueReminders(deps: LoopDeps, now=new Date()): Promise<number> {
  const rows=await deps.store.raw<{phone_hash:string}[]>`select phone_hash from weekly_reminders where state='scheduled' and due_at<=${now} order by due_at limit 50`;
  let count=0;
  for(const row of rows) await deps.store.raw.begin(async tx=>{
    const [caller]=await tx`select * from callers where phone_hash=${row.phone_hash} for update`;
    const [r]=await tx`select * from weekly_reminders where phone_hash=${row.phone_hash} and state='scheduled' and due_at<=${now} for update`;
    if(!r)return;
    const late=+now-+r['due_at']>15*MINUTE;
    if(!caller || !canRemind(caller,now) || late){
      await tx`update weekly_reminders set state=${late?'expired':'suppressed'},body_enc=null,updated_at=${now} where phone_hash=${row.phone_hash}`;return;
    }
    const phone=await deps.store.in(tx).phoneFor(row.phone_hash);
    if(!phone || !r['body_enc'])return;
    const template=deps.script.get('reminder.sms');if(!template)throw new Error('Missing reminder.sms');
    await enqueue(tx,{eventKey:`reminder:${row.phone_hash}:${r['revision']}`,phoneHash:row.phone_hash,channel:'sms',kind:'reminder',reference:String(r['revision']),
      to:phone,body:template.replace('{{text}}',decrypt(r['body_enc'])),expiresAt:new Date(+r['due_at']+15*MINUTE)},now);
    await tx`update weekly_reminders set state='queued',updated_at=${now} where phone_hash=${row.phone_hash}`;count++;
  });
  return count;
}
export async function pruneWeekly(sql: Database, now=new Date()): Promise<void> {
  await sql`delete from weekly_reminder_drafts where expires_at<=${now}`;
  await sql`delete from weekly_tool_requests where at<${new Date(+now-86400_000)}`;
  await sql`delete from weekly_tip_offers where offered_at<${new Date(+now-60*86400_000)}`;
  await sql`delete from weekly_tip_assignments where assigned_at<${new Date(+now-60*86400_000)}`;
  await sql`delete from weekly_reminders where updated_at<${new Date(+now-30*86400_000)} and state not in ('scheduled','queued')`;
  await sql`update weekly_reminders set state='expired',body_enc=null,updated_at=${now} where state in ('scheduled','queued') and due_at<${new Date(+now-15*MINUTE)}`;
}
