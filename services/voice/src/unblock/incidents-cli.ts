import { config } from '../config.ts';
import { PostgresStore } from '../store/postgres.ts';
import { acknowledgeUnblockIncident, reconcileUnblockIncidents, resolveUnblockIncident } from './incidents.ts';

const args = process.argv.slice(2);
const list = args.length === 1 && args[0] === '--list';
const ack = args.length === 2 && args[0] === '--ack';
const resolve = args.length === 3 && args[0] === '--resolve' && args[2] === '--reviewed';
if ((!list && !ack && !resolve) || (!list && !/^[a-f0-9-]{36}$/.test(args[1]!)) || !config.database.url) {
  console.error('Use private server access: npm run unblock:incidents -- --list | --ack ID | --resolve ID --reviewed'); process.exitCode = 1;
} else {
  const store = new PostgresStore(config.database.url);
  try {
    await reconcileUnblockIncidents(store.raw);
    if (ack) await acknowledgeUnblockIncident(store.raw, args[1]!);
    if (resolve) await resolveUnblockIncident(store.raw, args[1]!);
    if (list) {
      const rows = await store.raw`select i.id,i.created_at,i.ack_due_at,i.acknowledged_at,i.blocked_at,i.failure,m.status as alert_status,a.provider_call_id as private_conversation
        from unblock_incidents i left join message_outbox m on m.id=i.alert_id left join call_attempts a on a.id=i.attempt_id where i.resolved_at is null order by i.created_at`;
      console.log(JSON.stringify(rows));
    } else console.log(JSON.stringify({ confirmed: true, action: ack ? 'acknowledged' : 'review_completed', callsResumed: false }));
  } catch {
    console.error('Incident action was not confirmed. Inspect --list privately; acknowledgement and completed review are separate actions.'); process.exitCode = 1;
  } finally { await store.close(); }
}
