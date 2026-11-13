import type { Database } from '../store/transaction.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { decrypt,encrypt } from '../store/crypto.ts';
import { enqueue } from '../messages/outbox.ts';
import { available, eligible, fromRow, isQuiet, localClock, nextAfter } from './preferences.ts';
import { choose, compose } from './content.ts';

export async function queueEncouragement(deps:LoopDeps,now=new Date()):Promise<number>{
  const rows=await deps.store.raw<{phone_hash:string}[]>`select phone_hash from encouragement_preferences where enabled and not paused and next_at<=${now} order by next_at limit 50`;
  let count=0;
  for(const row of rows)await deps.store.raw.begin(async tx=>{
    const [caller]=await tx`select * from callers where phone_hash=${row.phone_hash} for update`;
    const [record]=await tx`select * from encouragement_preferences where phone_hash=${row.phone_hash} and enabled and not paused and next_at<=${now} for update`;
    if(!record)return;
    const p=fromRow(record),local=localClock(now,p.timezone);
    await tx`update encouragement_preferences set next_at=${nextAfter(now,p)} where phone_hash=${row.phone_hash}`;
    if(!caller || !available(row.phone_hash) || !eligible(caller,now) || local.minute<600 || local.day!==localClock(p.nextAt!,p.timezone).day
      || isQuiet(local.minute,p) || +now-+p.nextAt!>120*60_000)return;
    const existing=await tx`select id from encouragement_deliveries where phone_hash=${row.phone_hash} and local_day=${local.day}`;
    if(existing.length)return;
    const history=await tx<{variant:string;feedback:string|null}[]>`select variant,feedback from encouragement_deliveries where phone_hash=${row.phone_hash} order by created_at desc limit 30`;
    const v=choose(p,`${row.phone_hash}:${local.day}`,Number(caller['weeks_done'])>0,history);
    const phone=await deps.store.in(tx).phoneFor(row.phone_hash);
    if(!v || !phone)return;
    const body=compose(v,p);
    const id=await enqueue(tx,{eventKey:`encouragement:${row.phone_hash}:${local.day}`,phoneHash:row.phone_hash,channel:'sms',kind:'encouragement',
      reference:String(p.revision),to:phone,body,expiresAt:new Date(+now+120*60_000)},now);
    const pilot=(process.env['ENCOURAGEMENT_PILOT_HASHES']??'').split(',').includes(row.phone_hash);
    await tx`insert into encouragement_deliveries (id,phone_hash,revision,local_day,variant,topic,tone,arm,pilot,adaptive,body_enc,created_at)
      values (${id},${row.phone_hash},${p.revision},${local.day},${v.id},${v.topic},${v.tone},${v.arm},${pilot},${history.some(h=>!!h.feedback)},${encrypt(body)},${now})`;
    count++;
  });
  return count;
}
/** The outbox holds the caller lock throughout this check and provider submission. */
export async function suppression(sql:Database,hash:string,reference:string|null,caller:Record<string,unknown>,now:Date,id:string):Promise<string|undefined>{
  if(!available(hash))return 'encouragement_pilot_only';
  const [r]=await sql`select * from encouragement_preferences where phone_hash=${hash} for update`;
  if(!r)return 'encouragement_off';
  const p=fromRow(r);
  if(!p.enabled || p.paused || reference!==String(p.revision))return 'encouragement_changed';
  if(!eligible(caller,now))return 'encouragement_controls_changed';
  const [delivery]=await sql`select local_day,topic from encouragement_deliveries where id=${id} and phone_hash=${hash}`;
  if(!delivery || delivery['local_day']!==localClock(now,p.timezone).day)return 'encouragement_day_changed';
  if(delivery['topic']==='recognition' && !(Number(caller['weeks_done'])>0))return 'encouragement_context_changed';
  if(isQuiet(localClock(now,p.timezone).minute,p))return 'quiet_hours';
  const active=await sql`select id from call_attempts where phone_hash=${hash} and status in ('claimed','placed','active','settling') limit 1`;
  const recent=await sql`select id from message_outbox where phone_hash=${hash} and channel='sms' and (accepted_at>${new Date(+now-2*3600_000)}
    or kind<>'encouragement' and status='sending' and started_at>${new Date(+now-2*3600_000)}) limit 1`;
  if(active.length||recent.length)return 'wait_for_spacing';
  return undefined;
}
export async function feedback(sql:Database,hash:string,id:string,response:string,now=new Date()):Promise<boolean>{
  if(!available(hash)||!['more','less','clear'].includes(response))return false;
  await sql`select phone_hash from callers where phone_hash=${hash} for update`;
  const rows=await sql`update encouragement_deliveries d set feedback=${response==='clear'?null:response},feedback_at=${now}
    from message_outbox m where d.id=${id} and d.phone_hash=${hash} and m.id=d.id and m.status in ('accepted','delivered') returning d.id`;
  // Less must take effect even if another message with this wording is already queued.
  if(rows.length && response==='less')await sql`update message_outbox m set status='suppressed',reason='encouragement_feedback',payload_enc=null,recipient_enc=null
    from encouragement_deliveries d where m.id=d.id and d.phone_hash=${hash} and m.status='pending'
    and d.variant=(select variant from encouragement_deliveries where id=${id} and phone_hash=${hash})`;
  return rows.length>0;
}
export async function recent(sql:Database,hash:string){
  const rows=await sql<{id:string;topic:string;tone:string;status:string;feedback:string|null;created_at:Date;body_enc:string}[]>`select d.id,d.topic,d.tone,d.feedback,d.created_at,d.body_enc,m.status from encouragement_deliveries d
    join message_outbox m on m.id=d.id where d.phone_hash=${hash} and m.status in ('accepted','delivered','uncertain','failed') order by d.created_at desc limit 5`;
  return rows.map(({body_enc,...row})=>({...row,body:decrypt(body_enc).split('\n')[0]!}));
}
export async function pruneEncouragement(sql:Database,now=new Date()):Promise<void>{
  await sql`delete from encouragement_deliveries where created_at<${new Date(+now-30*86400_000)}`;
}
