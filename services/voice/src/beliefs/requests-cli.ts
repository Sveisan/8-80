import '../config.ts';
import { config } from '../config.ts';
import { PostgresStore } from '../store/postgres.ts';
import {resolveWithoutRefund,releaseUnusedCheckin} from './operator.ts';

/** Operator-only server CLI. Never places calls, sends messages or issues refunds. */
const store=new PostgresStore(config.database.url);
try {
  const action=process.argv[2];const id=process.argv[3];
  if(!action){
    const rows=await store.raw`select r.id,r.programme_id,r.reason,r.guaranteed,r.status,r.requested_at,e.provider,e.purchase_id,e.first_connected_at
      from belief_refund_requests r join belief_enrollments e on e.id=r.programme_id where r.status='requested' order by r.requested_at limit 100`;
    console.log('Beliefs requests — internal IDs only; no names, contacts, keys or practice content. Refunds require the provider console and canonical reconciliation.');
    for(const row of rows)console.log(JSON.stringify(row));
    const [retention]=await store.raw`select count(*)::int as awaiting_notice_delivery_or_acknowledgment from belief_enrollments where history_deleted_at is null and history_delete_at<=now() and retention_delivered_at is null`;
    console.log(JSON.stringify(retention));
  } else if(action==='close-resolved' && id && process.argv[4]==='--confirmed-no-refund'){
    await resolveWithoutRefund(store.raw,id);
    console.log('Request resolved without a refund. Unfinished practice remains paused; the customer chooses whether to resume.');
  } else if(action==='release-checkin' && id && process.argv[4]==='--confirmed-not-connected'){
    await releaseUnusedCheckin(store.raw,id);
    console.log('Provider review recorded. The customer may explicitly book the unused included check-in; nothing has been sent or scheduled.');
  } else throw Error('Use beliefs:requests, close-resolved <request-id> --confirmed-no-refund, or release-checkin <programme-id> --confirmed-not-connected.');
} catch(error){console.error(error instanceof Error && !('code' in error)?error.message:'The operation could not be confirmed. Keep database diagnostics private.');process.exitCode=1;}
finally{await store.close();}
