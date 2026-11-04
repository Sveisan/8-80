import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { LoopDeps } from '../loop/deps.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { canRemind, invalidateReminder, reminderTime, reminderView, WeeklyToolError } from './reminders.ts';
import { nextTip, consumeTopic } from './tips.ts';

export function weeklyToolsReady(env: NodeJS.ProcessEnv=process.env): boolean {
  const pilot=/^[a-f0-9]{64}$/.test(env['WEEKLY_TOOLS_PILOT_HASH']??'');
  return (env['WEEKLY_TOOLS_READY']==='1' || pilot) && (env['WEEKLY_TOOL_SECRET']?.length??0)>=32 && env['SPEECHIFY_SEND_VARIABLES']==='1';
}
export function weeklyToolsAllowed(hash: string|undefined, env: NodeJS.ProcessEnv=process.env): boolean {
  return weeklyToolsReady(env) && (env['WEEKLY_TOOLS_READY']==='1' || !!hash && hash===env['WEEKLY_TOOLS_PILOT_HASH']);
}
export function weeklyToken(attemptId: string): string {
  const secret=process.env['WEEKLY_TOOL_SECRET'];
  if(!secret || secret.length<32)throw new WeeklyToolError('unauthorized');
  return createHmac('sha256',secret).update(`8and80:weekly:${attemptId}`).digest('base64url');
}
export function weeklyCallContext(attemptId: string, timezone: string | undefined, now: Date, hash?: string): string {
  return JSON.stringify(weeklyToolsAllowed(hash) ? {available:true,attempt_id:attemptId,session_token:weeklyToken(attemptId),timezone:timezone??null,now:now.toISOString()} : {available:false});
}
const string=(v:unknown)=>typeof v==='string'?v:'';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};

/** All effects are caller-scoped, serialised with controls/deletion, and locally idempotent. */
export async function weeklyTool(deps: LoopDeps, input: unknown, now=new Date()): Promise<Record<string,unknown>> {
  const v=object(input), id=string(v['attempt_id']), token=string(v['session_token']), command=string(v['command']);
  if(!weeklyToolsReady() || !/^[a-zA-Z0-9_-]{1,120}$/.test(id))throw new WeeklyToolError('unauthorized');
  const expected=Buffer.from(weeklyToken(id)), supplied=Buffer.from(token);
  if(expected.length!==supplied.length || !timingSafeEqual(expected,supplied))throw new WeeklyToolError('unauthorized');
  return deps.store.raw.begin(async tx=>{
    const [lookup]=await tx`select phone_hash from call_attempts where id=${id}`;
    if(!lookup)throw new WeeklyToolError('unauthorized');
    const hash=String(lookup['phone_hash']);
    if(!weeklyToolsAllowed(hash))throw new WeeklyToolError('unauthorized');
    const [caller]=await tx`select * from callers where phone_hash=${hash} for update`;
    const [attempt]=await tx`select * from call_attempts where id=${id} for update`;
    const [belief]=await tx`select id from belief_sessions where id=${id}`;
    if(!caller || !attempt || belief || !['placed','active'].includes(attempt['status'])
      || !attempt['started_at'] || +now-+attempt['started_at']>45*60_000 || now<attempt['started_at'])throw new WeeklyToolError('session_closed');
    const reminder=await reminderView(tx,hash);
    const remindersAvailable=!deps.sms.previewOnly&&canRemind(caller,now);
    if(command==='status')return {reminder,tips_enabled:caller['tips_enabled'],timezone:caller['timezone'],now:now.toISOString(),reminders_available:remindersAvailable};
    if(command==='context') {
      const eligible=!caller['paused']&&!caller['all_calls_stopped']&&!caller['held_for_review']&&!caller['sms_opt_out'] && +now-+attempt['started_at']>=180_000;
      return {tip:eligible?await nextTip(tx,hash,id,deps.script,now,!deps.sms.previewOnly):null,reminder,tips_enabled:caller['tips_enabled'],reminders_available:remindersAvailable,timezone:caller['timezone'],now:now.toISOString()};
    }
    const request=string(v['request_id']);
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(request))throw new WeeklyToolError('request_id_required');
    const requestId=`${id}:${request}`;
    const digest=createHmac('sha256',process.env['WEEKLY_TOOL_SECRET']!).update(JSON.stringify(Object.fromEntries(Object.entries(v).filter(([k])=>k!=='session_token').sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
    const [receipt]=await tx`select input_hash,response_enc from weekly_tool_requests where id=${requestId}`;
    if(receipt){
      if(receipt['input_hash']!==digest)throw new WeeklyToolError('request_id_conflict');
      return {...JSON.parse(decrypt(receipt['response_enc'])),replayed:true,current_reminder:reminder};
    }
    let out:Record<string,unknown>;
    if(command==='tips_off' || command==='tips_on'){
      await tx`update callers set tips_enabled=${command==='tips_on'},updated_at=${now} where phone_hash=${hash}`;
      if(command==='tips_off')await tx`update weekly_tip_assignments set opted_out_at=coalesce(opted_out_at,${now}) where phone_hash=${hash}`;
      out={tips_enabled:command==='tips_on'};
    } else if(command==='tip_presented' || command==='tip_response'){
      if(!caller['tips_enabled'])throw new WeeklyToolError('tips_disabled');
      const response=string(v['response']);
      if(command==='tip_response' && !['accepted','declined'].includes(response))throw new WeeklyToolError('explicit_response_required');
      const [offer]=await tx`update weekly_tip_offers set reported_at=coalesce(reported_at,${now}),
        response=case when ${command==='tip_response'} then ${response} else response end
        where attempt_id=${id} and tip_id=${string(v['tip_id'])} returning tip_id,topic`;
      if(!offer)throw new WeeklyToolError('tip_not_offered');
      if(command==='tip_response' && response==='declined')await consumeTopic(tx,hash,offer['topic']);
      out={recorded:true};
    } else if(command==='reminder_prepare'){
      if(!remindersAvailable)throw new WeeklyToolError('reminders_unavailable');
      const text=string(v['text']).trim();
      if(!text || text.length>240 || Array.from(text).some(c=>c.charCodeAt(0)<32))throw new WeeklyToolError('short_reminder_text_required');
      const zone=string(caller['timezone']);if(!zone)throw new WeeklyToolError('timezone_required');
      const due=reminderTime(string(v['date']),string(v['time']),zone,now);
      // A reminder must still be within the entitlement explicitly granted now.
      const boundary=caller['cancel_at_period_end']?caller['paid_until']:caller['billing_status']==='trialing'?caller['trial_ends_at']:null;
      if(boundary && due>=boundary)throw new WeeklyToolError('reminder_beyond_access');
      const draft=randomUUID();
      await tx`delete from weekly_reminder_drafts where attempt_id=${id}`;
      await tx`insert into weekly_reminder_drafts(id,phone_hash,attempt_id,revision,body_enc,replaces_pending,due_at,timezone,expires_at)
        values(${draft},${hash},${id},${reminder?.revision??0},${encrypt(text)},${!!reminder&&['scheduled','queued'].includes(reminder.state)},${due},${zone},${new Date(+now+10*60_000)})`;
      out={draft_id:draft,text,date:v['date'],time:v['time'],timezone:zone,channel:'sms',replaces_existing:!!reminder&&['scheduled','queued'].includes(reminder.state),
        instruction:'Read back this exact text, full date, local time, timezone and one SMS. Ask for explicit confirmation. Nothing has been scheduled or changed yet.'};
    } else if(command==='reminder_confirm'){
      if(!remindersAvailable)throw new WeeklyToolError('reminders_unavailable');
      if(v['confirmed']!==true)throw new WeeklyToolError('explicit_confirmation_required');
      const [draft]=await tx`select * from weekly_reminder_drafts where id=${string(v['draft_id'])} and attempt_id=${id} and phone_hash=${hash} and expires_at>${now} for update`;
      if(!draft || draft['revision']!==(reminder?.revision??0))throw new WeeklyToolError('draft_expired_or_reminder_changed');
      if(draft['replaces_pending'] && !['scheduled','queued'].includes(reminder?.state??''))throw new WeeklyToolError('original_reminder_no_longer_pending');
      const boundary=caller['cancel_at_period_end']?caller['paid_until']:caller['billing_status']==='trialing'?caller['trial_ends_at']:null;
      if(boundary && draft['due_at']>=boundary)throw new WeeklyToolError('reminder_beyond_access');
      if(+draft['due_at']<+now+60_000)throw new WeeklyToolError('time_has_passed');
      await invalidateReminder(tx,hash);
      await tx`insert into weekly_reminders(phone_hash,revision,body_enc,due_at,timezone,state,attempt_id,updated_at)
        values(${hash},${draft['revision']+1},${draft['body_enc']},${draft['due_at']},${draft['timezone']},'scheduled',${id},${now})
        on conflict(phone_hash) do update set revision=excluded.revision,body_enc=excluded.body_enc,due_at=excluded.due_at,timezone=excluded.timezone,state='scheduled',attempt_id=excluded.attempt_id,updated_at=excluded.updated_at`;
      await tx`delete from weekly_reminder_drafts where phone_hash=${hash}`;
      out={saved:true,reminder:await reminderView(tx,hash)};
    } else if(command==='reminder_cancel'){
      if(reminder?.state==='sending') {
        if(v['revision']!==reminder.revision)throw new WeeklyToolError('reminder_changed_read_status');
        await invalidateReminder(tx,hash);
        await tx`update weekly_reminders set revision=revision+1,state='cancellation_unconfirmed',body_enc=null,updated_at=${now} where phone_hash=${hash}`;
        await tx`delete from weekly_reminder_drafts where phone_hash=${hash}`;
        out={cancelled:false,future_delivery_stopped:true,delivery_unconfirmed:true,instruction:'Future unsent work was stopped, but the provider may already have accepted this message. Do not claim confirmed cancellation or recall.'};
      }
      else if(!reminder || !['scheduled','queued'].includes(reminder.state))out={cancelled:false,reminder,instruction:'No pending reminder was cancelled. If already accepted or delivered, it cannot be recalled.'};
      else {
        if(v['revision']!==reminder.revision)throw new WeeklyToolError('reminder_changed_read_status');
        await invalidateReminder(tx,hash);
        await tx`update weekly_reminders set revision=revision+1,state='cancelled',body_enc=null,updated_at=${now} where phone_hash=${hash}`;
        await tx`delete from weekly_reminder_drafts where phone_hash=${hash}`;
        out={cancelled:true};
      }
    } else throw new WeeklyToolError('unknown_command');
    await tx`insert into weekly_tool_requests(id,phone_hash,attempt_id,input_hash,response_enc,at) values(${requestId},${hash},${id},${digest},${encrypt(JSON.stringify(out))},${now})`;
    return out;
  });
}
