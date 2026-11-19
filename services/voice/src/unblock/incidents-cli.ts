import { config } from '../config.ts';
import { PostgresStore } from '../store/postgres.ts';
import { acknowledgeUnblockIncident, reconcileUnblockIncidents, recordUnblockIncidentAction, resolveUnblockIncident, type IncidentAction, type IncidentResolution } from './incidents.ts';

const args = process.argv.slice(2);
const list = args.length === 1 && args[0] === '--list';
const ack = args.length === 2 && args[0] === '--ack';
const escalated = args.length === 2 && args[0] === '--escalated';
const reviewed = args.length === 5 && args[4] === '--reviewed';
const disclosed = reviewed && args[0] === '--disclosed' && args[2] === '--basis' && ['consent', 'reviewed-emergency-basis'].includes(args[3]!);
const handoff = reviewed && args[0] === '--handoff' && args[2] === '--basis' && ['caller-confirmed', 'human-confirmed'].includes(args[3]!);
const resolve = reviewed && args[0] === '--resolve' && args[2] === '--outcome' && ['handoff-confirmed', 'no-handoff-needed'].includes(args[3]!);
if ((!list && !ack && !escalated && !disclosed && !handoff && !resolve) || (!list && !/^[a-f0-9-]{36}$/.test(args[1]!)) || !config.database.url) {
  console.error('Private server only: --list | --ack ID | --escalated ID | --disclosed ID --basis consent|reviewed-emergency-basis --reviewed | --handoff ID --basis caller-confirmed|human-confirmed --reviewed | --resolve ID --outcome handoff-confirmed|no-handoff-needed --reviewed. Records actions already taken; sends nothing.'); process.exitCode = 1;
} else {
  const store = new PostgresStore(config.database.url);
  try {
    await reconcileUnblockIncidents(store.raw);
    if (ack) await acknowledgeUnblockIncident(store.raw, args[1]!);
    let action: IncidentAction | undefined;
    if (escalated) action = { type: 'escalated' };
    if (disclosed) action = { type: 'disclosed', basis: args[3] === 'consent' ? 'consent' : 'reviewed_emergency_basis', reviewed: true };
    if (handoff) action = { type: 'handoff', basis: args[3] === 'caller-confirmed' ? 'caller_confirmed' : 'human_confirmed', reviewed: true };
    if (action) await recordUnblockIncidentAction(store.raw, args[1]!, action);
    if (resolve) await resolveUnblockIncident(store.raw, args[1]!, new Date(), args[3]!.replaceAll('-', '_') as IncidentResolution);
    if (list) {
      const rows = await store.raw`select i.id,i.created_at,i.ack_due_at,i.acknowledged_at,i.blocked_at,i.failure,
        i.escalated_at,i.disclosed_at,i.disclosure_basis,i.handoff_at,i.handoff_basis,i.resolution,m.status as alert_status,a.provider_call_id as private_conversation
        from unblock_incidents i left join message_outbox m on m.id=i.alert_id left join call_attempts a on a.id=i.attempt_id where i.resolved_at is null order by i.created_at`;
      console.log(JSON.stringify(rows));
    } else console.log(JSON.stringify({ confirmed: true, action: ack ? 'acknowledged' : action?.type ?? 'review_completed', callsResumed: false, externalContactMadeByCommand: false }));
  } catch {
    console.error('Incident action was not confirmed. Inspect --list privately. Acknowledgement, a confirmed handoff and completed review are separate actions; do not close unresolved help as a handoff.'); process.exitCode = 1;
  } finally { await store.close(); }
}
