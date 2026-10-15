import type {Database} from '../store/transaction.ts';
import {transaction} from '../store/transaction.ts';
import {BeliefRepository} from './repository.ts';
import {encrypt} from '../store/crypto.ts';

/** Call only after a human resolves the support case without returning money. */
export async function resolveWithoutRefund(sql:Database,id:string):Promise<void>{
    await transaction(sql,async tx=>{
      const [r]=await tx`select e.phone_hash,r.programme_id from belief_refund_requests r join belief_enrollments e on e.id=r.programme_id where r.id=${id} and r.status='requested'`;
      if(!r)throw Error('Unknown request.');
      await tx`select phone_hash from callers where phone_hash=${r['phone_hash']} for update`;
      const [pending]=await tx`select id from belief_refund_requests where id=${id} and status='requested' for update`;
      if(!pending)throw Error('Request has already been resolved.');
      const repo=new BeliefRepository(tx,r['programme_id']);const loaded=await repo.load(r['phone_hash']);if(!loaded)throw Error('Unknown programme.');
      if(loaded.practice.state!=='completed' && loaded.practice.state!=='paused'){
        const p={...loaded.practice,state:'paused',revision:loaded.practice.revision+1};
        await tx`update belief_enrollments set practice_enc=${encrypt(JSON.stringify(p))},revision=${p.revision} where id=${r['programme_id']}`;
      }
      await tx`update belief_refund_requests set status='resolved',resolved_at=now() where id=${id} and status='requested'`;
      await tx`update belief_enrollments set standing='active' where id=${r['programme_id']} and standing='refund_requested'`;
    });
}

/** Release only after provider evidence confirms that this attempt did not connect. */
export async function releaseUnusedCheckin(sql:Database,id:string):Promise<void>{
    await transaction(sql,async tx=>{
      const [e]=await tx`select phone_hash,checkin_attempt_id from belief_enrollments where id=${id}`;if(!e)throw Error('Unknown programme.');
      await tx`select phone_hash from callers where phone_hash=${e['phone_hash']} for update`;
      const [current]=await tx`select checkin_attempt_id,checkin_used_at from belief_enrollments where id=${id} for update`;
      if(!current?.['checkin_attempt_id'] || current['checkin_used_at'])throw Error('No unspent uncertain check-in.');
      const [a]=await tx`select status from call_attempts where id=${current['checkin_attempt_id']}`;
      if(a?.['status']!=='failed')throw Error('Only a closed uncertain attempt can be released after provider review.');
      await tx`update belief_sessions set coverage_enc=${encrypt(JSON.stringify({operatorConfirmedNotConnected:true,at:new Date().toISOString()}))} where id=${current['checkin_attempt_id']}`;
      await tx`update belief_enrollments set checkin_attempt_id=null where id=${id}`;
    });
}
