import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { encrypt, decrypt } from '../store/crypto.ts';
import type { LoopDeps } from '../loop/deps.ts';
import type postgres from 'postgres';
import { nextSlotAfter } from '../schedule/time.ts';
import { safetyTier } from '../call/safety.ts';
import { toTranscript, eventOf } from '../webhook/speechify.ts';
import { enqueue } from '../messages/outbox.ts';
import { obj, str } from '../billing/types.ts';
import { beliefConfig } from './config.ts';
import { beliefReadiness } from './readiness.ts';
import { withinCoverage } from './coverage.ts';
import { BeliefRepository, nextDaily } from './repository.ts';
import { activeBeliefs, PracticeError } from './model.ts';
import { sessionToken, verifySessionToken, capture, verifiedPractice, fullCoverage, closedSnapshot, type Kind, type Snapshot } from './protocol.ts';

interface Session { id:string; phone_hash:string; kind:Kind; week:number|null; snapshot_enc:string; complete:boolean; created_at:Date; }
const emptyScript=new Map<string,string>();
async function safety(sql: postgres.TransactionSql, session:Session, callerText:string, now:Date):Promise<boolean> {
  const finding=safetyTier([{speaker:'caller',text:callerText}],emptyScript);if(!finding)return false;
  await sql`update call_attempts set safety_tier=least(coalesce(safety_tier,3),${finding.tier}) where id=${session.id}`;
  await sql`update callers set held_for_review=true,updated_at=${now} where phone_hash=${session.phone_hash}`;
  if(finding.tier===1)for(const [i,to] of config.operator.phones().entries())await enqueue(sql,{eventKey:`beliefs:safety:${session.id}:${i}`,phoneHash:session.phone_hash,channel:'sms',kind:'safety',to,
    body:'8&80: a belief call needs urgent human review (tier 1). All calls for this account are on hold. On the server: npm run enrol -- --review'},now);
  return true;
}
export async function beliefTool(deps:LoopDeps,input:unknown,now=new Date()):Promise<Record<string,unknown>> {
  const v=obj(input);const id=str(v?.['session_id'])??'';const token=str(v?.['session_token'])??'';
  if(!verifySessionToken(id,token,beliefConfig().toolSecret))throw new PracticeError('unauthorized');
  return deps.store.raw.begin(async tx=>{
    const [lookup]=await tx<Session[]>`select * from belief_sessions where id=${id}`;if(!lookup)throw new PracticeError('unauthorized');
    const [caller]=await tx`select held_for_review,all_calls_stopped,sms_opt_out from callers where phone_hash=${lookup.phone_hash} for update`;
    const [session]=await tx<Session[]>`select * from belief_sessions where id=${id} for update`;
    const [attempt]=await tx`select status from call_attempts where id=${id} for update`;
    if(!caller || !session || session.complete || !['claimed','placed'].includes(attempt?.['status']) || +now-+session.created_at>45*60_000)throw new PracticeError('session_closed');
    const callerText=str(v?.['caller_text'])??'';
    if(callerText.length>16000)throw new PracticeError('wording_required');
    if(await safety(tx,session,callerText,now))return {held:true,instruction:'Stop belief practice and follow the approved safety procedure. Do not continue evidence questions.'};
    if(caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'])return {held:true,instruction:'Stop this practice. No further changes are accepted.'};
    const loaded=await new BeliefRepository(tx).load(session.phone_hash);
    const snapshot=JSON.parse(decrypt(session.snapshot_enc)) as Snapshot;
    if(!loaded || loaded.enrollment.standing!=='active' || loaded.practice.state==='paused' || loaded.practice.revision!==snapshot.revision)throw new PracticeError('page_changed');
    if(v?.['command']===undefined)return {held:false}; // Caller-utterance safety check.
    const next=capture(snapshot,session.kind,session.week,input,now);
    await tx`update belief_sessions set snapshot_enc=${encrypt(JSON.stringify(next))} where id=${id}`;
    return {practice:next.practice,coverage:next.coverage,provisional:true,instruction:'Read back only what the caller said; changes are confirmed after the signed transcript.'};
  });
}
export async function claimBeliefs(deps:LoopDeps,now=new Date()):Promise<Session[]> {
  const candidates=await deps.store.raw<{phone_hash:string}[]>`select phone_hash from belief_enrollments where standing='active' and
    (onboarding_at<=${now} or next_daily_at<=${now} or next_weekly_at<=${now}) order by updated_at limit 50`;
  const claimed:Session[]=[];
  for(const candidate of candidates)await deps.store.raw.begin(async tx=>{
    const [caller]=await tx`select held_for_review,all_calls_stopped,sms_opt_out,next_call_at from callers where phone_hash=${candidate.phone_hash} for update skip locked`;if(!caller)return;
    const loaded=await new BeliefRepository(tx).load(candidate.phone_hash);if(!loaded || loaded.enrollment.standing!=='active')return;
    const {enrollment:e,practice:p}=loaded;
    const due:{kind:Kind;at:Date}[]=p.understood?[...(e.next_daily_at&&e.next_daily_at<=now?[{kind:'daily' as const,at:e.next_daily_at}]:[]),...(e.next_weekly_at&&e.next_weekly_at<=now?[{kind:'weekly' as const,at:e.next_weekly_at}]:[])]:e.onboarding_at&&e.onboarding_at<=now?[{kind:'onboarding',at:e.onboarding_at}]:[];
    for(const d of due){
      const blocked=caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'] || ['paused','completed'].includes(p.state) || (d.kind==='daily' && activeBeliefs(p).length===0);
      const late=+now-+d.at>5*60_000;
      const nearBase=caller['next_call_at'] && Math.abs(+caller['next_call_at']-+d.at)<45*60_000;
      const recent=await tx`select id from call_attempts where phone_hash=${e.phone_hash} and
        (status in ('claimed','placed','settling') or scheduled_for between ${new Date(+now-45*60_000)} and ${new Date(+now+45*60_000)}) limit 1`;
      // Advance first, under the caller lock: no backlog of ringing after an outage/hold.
      if(d.kind==='onboarding')await tx`update belief_enrollments set onboarding_at=null,updated_at=${now} where phone_hash=${e.phone_hash}`;
      if(d.kind==='daily')await tx`update belief_enrollments set next_daily_at=${nextDaily(now,e.daily_minute!,e.timezone)},updated_at=${now} where phone_hash=${e.phone_hash}`;
      if(d.kind==='weekly')await tx`update belief_enrollments set next_weekly_at=${nextSlotAfter(now,{weekday:e.weekly_weekday!,minute:e.weekly_minute!,timezone:e.timezone})},updated_at=${now} where phone_hash=${e.phone_hash}`;
      if(blocked)continue;
      const id=randomUUID();const status=late||nearBase||recent.length?'missed':'claimed';
      const week=d.kind==='weekly'&&e.review_origin?Math.round((+d.at-+e.review_origin)/(7*86400_000)):null;
      const snapshot:Snapshot={revision:p.revision,initial:p,practice:p,receipts:[],coverage:{}};
      const [attempt]=await tx`insert into call_attempts(id,phone_hash,scheduled_for,status,note) values(${id},${e.phone_hash},${d.at},${status},${status==='missed'?'belief slot skipped: late or overlapping':null}) on conflict do nothing returning id`;
      if(!attempt)continue;
      const [session]=await tx<Session[]>`insert into belief_sessions(id,phone_hash,kind,week,snapshot_enc,complete,created_at) values(${id},${e.phone_hash},${d.kind},${week},${encrypt(status==='missed'?closedSnapshot(snapshot):JSON.stringify(snapshot))},${status==='missed'},${now}) returning *`;
      if(status==='claimed'&&session)claimed.push(session);
      else if(d.kind==='onboarding')await beliefNotice(tx,deps,e.phone_hash,id,'Your first Beliefs call could not happen at the booked time. Choose another time when it suits you.',now);
    }
  });
  return claimed;
}
async function beliefNotice(sql:postgres.TransactionSql,deps:LoopDeps,hash:string,id:string,text:string,now:Date):Promise<void> {
  const phone=await deps.store.in(sql).phoneFor(hash);const base=config.link.publicUrl().replace(/\/$/,'');
  if(phone&&base)await enqueue(sql,{eventKey:`beliefs:call:${id}`,phoneHash:hash,channel:'sms',kind:'beliefs',reference:id,to:phone,body:`${text} ${base}/beliefs/access`},now);
}
export async function tickBeliefs(deps:LoopDeps,now=new Date(),fetcher:typeof fetch=fetch):Promise<{claimed:number;placed:number;failed:number}> {
  const out={claimed:0,placed:0,failed:0};
  if(!beliefConfig().live || beliefReadiness().length || !withinCoverage(now))return out;
  const sessions=await claimBeliefs(deps,now);out.claimed=sessions.length;
  for(const s of sessions){
    try {
      // Hold the account lock through the placement request so STOP/deletion cannot race dispatch.
      await deps.store.raw.begin(async tx=>{
        const [caller]=await tx`select held_for_review,all_calls_stopped,sms_opt_out from callers where phone_hash=${s.phone_hash} for update`;
        const loaded=await new BeliefRepository(tx).load(s.phone_hash);
        if(!caller || caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'] || !loaded || loaded.enrollment.standing!=='active' || ['paused','completed'].includes(loaded.practice.state))throw new PracticeError('dispatch_stopped');
        const phone=await deps.store.in(tx).phoneFor(s.phone_hash);if(!phone)throw new PracticeError('dispatch_stopped');
        const c=beliefConfig();
        const response=await fetcher('https://api.speechify.ai/v1/agents/outbound-calls',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${process.env['SPEECHIFY_API_KEY']}`,'content-type':'application/json','Idempotency-Key':`beliefs:${s.id}`},
          body:JSON.stringify({agent_id:c.agentIds[s.kind],to:phone,...(config.speechify.callerIdNumber?{caller_id_number:config.speechify.callerIdNumber}:{}),dynamic_variables:{
            belief_context:JSON.stringify(loaded.practice),session_id:s.id,session_token:sessionToken(s.id,c.toolSecret),call_kind:s.kind
          },ringing_timeout_ms:30000})}); // AMD inherits the verified agent configuration.
        if(!response.ok)throw new PracticeError('placement_unconfirmed');
        const result=obj(await response.json());const conversationId=str(result?.['conversation_id']);if(!conversationId)throw new PracticeError('placement_unconfirmed');
        await tx`update call_attempts set status='placed',provider_call_id=${conversationId},started_at=${now} where id=${s.id} and status='claimed'`;
      });
      out.placed++;
    }catch{
      // An uncertain provider request is never blindly redialled. Sweep owns recovery.
      await deps.store.raw`update call_attempts set note='belief placement unconfirmed; do not redial' where id=${s.id}`;
      out.failed++;
    }
  }
  return out;
}
export async function settleBeliefs(payload:unknown,deps:LoopDeps,event?:string,now=new Date()):Promise<{handled:boolean;status?:string;why?:string}|undefined> {
  const t=toTranscript(payload);
  const [lookup]=await deps.store.raw<Session[]>`select s.* from belief_sessions s join call_attempts a on a.id=s.id where a.provider_call_id=${t.providerCallId}`;
  if(!lookup)return undefined;
  if(!eventOf(payload,event))return {handled:false,why:'event ignored'};
  return deps.store.raw.begin(async tx=>{
    const [caller]=await tx`select held_for_review,all_calls_stopped,sms_opt_out from callers where phone_hash=${lookup.phone_hash} for update`;
    const [s]=await tx<Session[]>`select * from belief_sessions where id=${lookup.id} for update`;
    if(!caller || !s || s.complete)return {handled:false,why:'already closed'};
    const said=t.turns.filter(turn=>turn.speaker==='caller').map(turn=>turn.text).join(' ');
    const flagged=await safety(tx,s,said,now);const snapshot=JSON.parse(decrypt(s.snapshot_enc)) as Snapshot;
    const loaded=await new BeliefRepository(tx).load(s.phone_hash);let status='interrupted';
    if(!flagged && !caller['held_for_review'] && !caller['all_calls_stopped'] && !caller['sms_opt_out'] && loaded?.enrollment.standing==='active' && loaded.practice.state!=='paused' && loaded.practice.revision===snapshot.revision && said.trim() && eventOf(payload,event)==='conversation.completed') {
      try {
        const verified=verifiedPractice(snapshot,said);
        { // Keep verified partial onboarding so an interruption does not erase discovery.
          await new BeliefRepository(tx).confirm(s.phone_hash,snapshot.revision,verified,now);
          status=fullCoverage(snapshot,s.kind)?'completed':'interrupted';
        }
      }catch(error){if(!(error instanceof PracticeError))throw error;status='unverified';}
    } else if(!said.trim())status='silent';
    await tx`update belief_sessions set complete=true,snapshot_enc=${encrypt(closedSnapshot(snapshot))},coverage_enc=${encrypt(JSON.stringify(snapshot.coverage))} where id=${s.id}`;
    await tx`update call_attempts set status=${status},ended_at=${now},duration_ms=${t.durationMs},note=${flagged?'belief call held for human review':status==='completed'?'belief call complete':'belief call incomplete'} where id=${s.id}`;
    if(!flagged && !caller['held_for_review']){
      if(s.kind==='weekly' && status==='completed')await beliefNotice(tx,deps,s.phone_hash,s.id,'Your weekly Beliefs review is saved. See what you are practising next.',now);
      else if(s.kind==='onboarding' && status==='completed')await beliefNotice(tx,deps,s.phone_hash,s.id,'Your decisions are ready. Your daily practice starts at the next time you chose.',now);
      else if(status!=='completed')await beliefNotice(tx,deps,s.phone_hash,s.id,s.kind==='onboarding'?'Your first conversation is not complete yet. Choose another time to continue.':'Your belief check-in was incomplete. There is no catch-up call; continue at your next usual time.',now);
    }
    return {handled:true,status};
  });
}
export async function closeBeliefSession(deps:LoopDeps,id:string,now=new Date()):Promise<boolean> {
  const [s]=await deps.store.raw<Session[]>`select * from belief_sessions where id=${id}`;if(!s)return false;
  await deps.store.raw.begin(async tx=>{
    await tx`select phone_hash from callers where phone_hash=${s.phone_hash} for update`;
    const [a]=await tx`select status from call_attempts where id=${id} for update`;
    if(!a || !['claimed','placed','settling'].includes(a['status']))return;
    await tx`update call_attempts set status='failed',ended_at=${now},note='belief call unconfirmed; no automatic redial' where id=${id}`;
    const [latest]=await tx`select snapshot_enc from belief_sessions where id=${id} for update`;
    const snapshot=JSON.parse(decrypt(latest!['snapshot_enc'])) as Snapshot;
    await tx`update belief_sessions set complete=true,snapshot_enc=${encrypt(closedSnapshot(snapshot))},coverage_enc=${encrypt(JSON.stringify(snapshot.coverage))} where id=${id}`;
    await beliefNotice(tx,deps,s.phone_hash,id,s.kind==='onboarding'?'Your first Beliefs call could not be confirmed. Choose a time to continue.':'Your belief check-in could not be confirmed. Continue at your next usual time.',now);
  });return true;
}
