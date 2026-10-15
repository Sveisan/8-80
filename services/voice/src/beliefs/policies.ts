import { randomUUID } from 'node:crypto';
import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import { encrypt } from '../store/crypto.ts';
import { config } from '../config.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { enqueue } from '../messages/outbox.ts';
import { emptyPractice, PracticeError, wording } from './model.ts';
import { BeliefRepository, appointmentInput, type Enrollment } from './repository.ts';
import { withinCoverage } from './coverage.ts';

const DAY=86400_000;
export function refundDeadline(first:Date|null):Date|null {return first?new Date(+first+14*DAY):null;}
export function guaranteedRefund(e:Pick<Enrollment,'first_connected_at'>,now=new Date()):boolean {
  const deadline=refundDeadline(e.first_connected_at);return !deadline || now<=deadline;
}

/** All customer operations bind to the selected programme, under the shared account lock. */
export class ProgrammePolicies {
  constructor(readonly sql:Database) {}
  private async locked<T>(hash:string,id:string,work:(tx:Database,loaded:NonNullable<Awaited<ReturnType<BeliefRepository['load']>>>)=>Promise<T>):Promise<T> {
    return transaction(this.sql,async tx=>{
      await tx`select phone_hash from callers where phone_hash=${hash} for update`;
      const loaded=await new BeliefRepository(tx,id).load(hash);
      if(!loaded)throw new PracticeError('enrollment_unknown');
      return work(tx,loaded);
    });
  }
  async newProgramme(hash:string,id:string,outcome:string,confirmed:boolean,now=new Date()):Promise<string> {
    return this.locked(hash,id,async(tx,{enrollment:e,practice:p})=>{
      if(!confirmed)throw new PracticeError('new_purchase_confirmation_required');
      if(!e.is_current || p.state!=='completed')throw new PracticeError('unfinished_programme');
      const inflight=await tx`select id from call_attempts where phone_hash=${hash} and status in ('claimed','placed','settling') limit 1`;
      if(inflight.length)throw new PracticeError('call_in_progress');
      const practice=emptyPractice();practice.outcome=wording(outcome);practice.contact=p.contact;
      const next=randomUUID();
      await tx`update belief_enrollments set is_current=false where id=${id}`;
      await tx`insert into belief_enrollments(id,phone_hash,checkout_reference,practice_enc,consent_version,consent_at,timezone)
        values(${next},${hash},${'beliefs:'+next},${encrypt(JSON.stringify(practice))},'beliefs-v2',${now},${e.timezone})`;
      return next;
    });
  }
  async requestRefund(hash:string,id:string,reason:string,deps:LoopDeps,now=new Date()):Promise<void> {
    await this.locked(hash,id,async(tx,{enrollment:e})=>{
      if(!e.purchase_id || !['guarantee','delivery','charge','other'].includes(reason))throw new PracticeError('refund_request_invalid');
      const [request]=await tx`insert into belief_refund_requests(programme_id,reason,guaranteed,requested_at)
        values(${id},${reason},${guaranteedRefund(e,now)},${now}) on conflict(programme_id) do nothing returning id`;
      if(!request)return; // A stale retry cannot reopen an already resolved case or pause again.
      // This is a request for human processing. Never claim or initiate a refund here.
      for(const [i,to] of config.operator.phones().entries())await enqueue(tx,{eventKey:`beliefs:refund:${request['id']}:${i}`,phoneHash:hash,channel:'sms',kind:'operator',reference:id,to,
        body:'8&80: a Beliefs refund or delivery request needs review. Run npm run beliefs:requests on the server. No refund has been issued automatically.'},now);
      await tx`update belief_enrollments set checkin_at=null,onboarding_at=null,next_daily_at=null,next_weekly_at=null,standing='refund_requested',updated_at=${now}
        where id=${id} and standing='active'`;
      void deps; // Dispatch remains with the existing durable worker.
    });
  }
  async bookCheckin(hash:string,id:string,form:URLSearchParams,now=new Date()):Promise<void> {
    await this.locked(hash,id,async(tx,{enrollment:e,practice:p})=>{
      const [caller]=await tx`select held_for_review,all_calls_stopped,sms_opt_out,next_call_at from callers where phone_hash=${hash}`;
      if(p.state!=='completed' || e.standing!=='active' || e.checkin_used_at || !caller || caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'])throw new PracticeError('checkin_unavailable');
      if(form.get('confirmed')!=='yes')throw new PracticeError('caller_confirmation_required');
      if(e.checkin_at)throw new PracticeError('page_changed');
      if(e.checkin_attempt_id){
        const [a]=await tx`select status from call_attempts where id=${e.checkin_attempt_id}`;
        if(!a || ['claimed','placed','settling','failed'].includes(a['status']))throw new PracticeError('call_in_progress');
      }
      const at=appointmentInput(form,e.timezone,now);
      if(!withinCoverage(at))throw new PracticeError('outside_coverage');
      const nearby=await tx`select id from belief_enrollments where phone_hash=${hash} and
        (onboarding_at between ${new Date(+at-45*60_000)} and ${new Date(+at+45*60_000)} or next_daily_at between ${new Date(+at-45*60_000)} and ${new Date(+at+45*60_000)} or next_weekly_at between ${new Date(+at-45*60_000)} and ${new Date(+at+45*60_000)} or checkin_at between ${new Date(+at-45*60_000)} and ${new Date(+at+45*60_000)})`;
      if(nearby.length || caller['next_call_at'] && Math.abs(+caller['next_call_at']-+at)<45*60_000)throw new PracticeError('calls_too_close');
      await tx`update belief_enrollments set checkin_at=${at},updated_at=${now} where id=${id}`;
    });
  }
  async cancelCheckin(hash:string,id:string):Promise<void> {
    await this.locked(hash,id,async(tx,{enrollment:e})=>{if(!e.checkin_at)throw new PracticeError('call_in_progress');await tx`update belief_enrollments set checkin_at=null where id=${id}`;});
  }
  async extendHistory(hash:string,id:string,until:string,now=new Date()):Promise<void> {
    await this.locked(hash,id,async(tx,{enrollment:e,practice:p})=>{
      // The customer chooses the exact date; no unapproved default extension period.
      const at=new Date(until+'T23:59:59Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(until) || !Number.isFinite(+at) || at.toISOString().slice(0,10)!==until || p.state!=='completed' || e.history_deleted_at || !e.history_delete_at || at<=e.history_delete_at || at<=now)throw new PracticeError('retention_date_invalid');
      await tx`update belief_enrollments set history_delete_at=${at},retention_notice_at=null,retention_delivered_at=null,updated_at=${now} where id=${id}`;
    });
  }
  async acknowledgeRetention(hash:string,id:string,now=new Date()):Promise<void> {
    await this.locked(hash,id,async(tx,{enrollment:e})=>{if(!e.history_delete_at || e.history_deleted_at)throw new PracticeError('retention_date_invalid');await tx`update belief_enrollments set retention_delivered_at=coalesce(retention_delivered_at,${now}) where id=${id}`;});
  }
  async deleteHistory(hash:string,id:string,confirmation:string,now=new Date()):Promise<void> {
    await this.locked(hash,id,async(tx,{enrollment:e,practice:p})=>{
      if(confirmation!=='DELETE HISTORY')throw new PracticeError('history_confirmation_required');
      if(p.state!=='completed')throw new PracticeError('unfinished_programme');
      await eraseProgrammeHistory(tx,e,now);
    });
  }
}

async function eraseProgrammeHistory(tx:Database,e:Enrollment,now:Date):Promise<void> {
  const inflight=await tx`select a.id from belief_sessions s join call_attempts a on a.id=s.id where s.programme_id=${e.id} and a.status in ('claimed','placed','settling') limit 1`;
  if(inflight.length)throw new PracticeError('call_in_progress');
  if(e.history_deleted_at)return;
  const p=emptyPractice();p.state='completed';p.understood=true;p.revision=e.revision+1;
  // Remove only this programme's personal content, including the short-lived delivery buffer.
  await tx`delete from webhook_deliveries where conversation_id in (select a.provider_call_id from call_attempts a join belief_sessions s on s.id=a.id where s.programme_id=${e.id})`;
  await tx`update belief_sessions set snapshot_enc=${encrypt('{"closed":true,"history_deleted":true}')},coverage_enc=null where programme_id=${e.id}`;
  await tx`update belief_enrollments set practice_enc=${encrypt(JSON.stringify(p))},history_deleted_at=${now},revision=revision+1,updated_at=${now} where id=${e.id}`;
}

/** Runs without placing calls, including when the Beliefs launch switch is off. */
export async function maintainBeliefPolicies(deps:LoopDeps,now=new Date()):Promise<void> {
  const rows=await deps.store.raw<{id:string;phone_hash:string}[]>`select id,phone_hash from belief_enrollments
    where history_deleted_at is null and (policy_checked_at is null or history_delete_at<=${new Date(+now+30*DAY)}) order by policy_checked_at nulls first,updated_at limit 50`;
  for(const row of rows)await deps.store.raw.begin(async tx=>{
    await tx`select phone_hash from callers where phone_hash=${row.phone_hash} for update`;
    const loaded=await new BeliefRepository(tx,row.id).load(row.phone_hash);if(!loaded)return;
    await tx`update belief_enrollments set policy_checked_at=${now} where id=${row.id}`;
    if(loaded.practice.state!=='completed')return;
    const e=loaded.enrollment;if(e.history_deleted_at)return;
    // Legacy completion dates are unknown: begin a full retention period when first observed.
    if(!e.completed_at){await tx`update belief_enrollments set completed_at=${now},history_delete_at=${now}::timestamptz+interval '12 months',updated_at=${now} where id=${e.id}`;return;}
    if(!e.history_delete_at)return;
    if(e.history_delete_at<=new Date(+now+30*DAY) && !e.retention_notice_at){
      const phone=await deps.store.in(tx).phoneFor(e.phone_hash);const base=config.link.publicUrl().replace(/\/$/,'');
      if(phone && base){await enqueue(tx,{eventKey:`beliefs:retention:${e.id}:${e.history_delete_at.toISOString()}`,phoneHash:e.phone_hash,channel:'sms',kind:'beliefs',reference:e.id,to:phone,
        body:`Your completed Beliefs history is due for deletion on ${e.history_delete_at.toISOString().slice(0,10)}. Export it, delete it or choose a later date in your private account: ${base}/beliefs/access`},now);
        await tx`update belief_enrollments set retention_notice_at=${now} where id=${e.id}`;}
    }
    const [notice]=await tx`select delivered_at from message_outbox where event_key=${`beliefs:retention:${e.id}:${e.history_delete_at.toISOString()}`} and status='delivered'`;
    const delivered=e.retention_delivered_at ?? notice?.['delivered_at'];
    if(delivered && !e.retention_delivered_at)await tx`update belief_enrollments set retention_delivered_at=${delivered} where id=${e.id}`;
    if(e.history_delete_at<=now && delivered && +now-+delivered>=30*DAY){try{await eraseProgrammeHistory(tx,e,now);}catch(error){if(!(error instanceof PracticeError) || error.code!=='call_in_progress')throw error;}}
  });
}
