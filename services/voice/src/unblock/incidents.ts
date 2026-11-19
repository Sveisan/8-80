import { randomUUID } from 'node:crypto';
import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { enqueue, dispatchMessage } from '../messages/outbox.ts';
import { unblockConfig } from './config.ts';

export const ACK_WINDOW_MS = 5 * 60_000;
/** Called in the safety transaction. One incident/alert per call, including a repeated completion. */
export async function openUnblockIncident(sql: Database, session: { id: string; phone_hash: string }, now: Date): Promise<void> {
  const id = randomUUID();
  const [created] = await sql`insert into unblock_incidents(id,attempt_id,created_at,ack_due_at)
    values(${id},${session.id},${now},${new Date(+now + ACK_WINDOW_MS)}) on conflict(attempt_id) do nothing returning id`;
  if (!created) return;
  const to = unblockConfig().operatorPhone;
  if (!to) return; // Missing delivery configuration is itself a blocking incident.
  const alert = await enqueue(sql, { eventKey: `unblock:safety:${session.id}:0`, phoneHash: session.phone_hash, channel: 'sms', kind: 'safety', to,
    body: `Unblock: urgent human review. Acknowledge within five minutes on the server: npm run unblock:incidents -- --ack ${id}. Future calls for this account are held. Review privately with npm run enrol -- --review.` }, now);
  await sql`update unblock_incidents set alert_id=${alert} where id=${id}`;
}

/** Read at every placement/check-in boundary, even if the minute worker has not yet recorded Away. */
export async function blockingUnblockIncident(sql: Database, now: Date): Promise<boolean> {
  const [row] = await sql`select i.id from unblock_incidents i left join message_outbox m on m.id=i.alert_id where i.resolved_at is null and
    (i.blocked_at is not null or m.id is null or m.status in ('failed','uncertain','suppressed')
      or (m.status='pending' and m.attempts>0 and m.reason is not null)
      or (m.status='sending' and m.started_at<=${new Date(+now - 90_000)})
      or (i.acknowledged_at is null and i.ack_due_at<=${now})) limit 1`;
  return !!row;
}

/** Lock order: availability, then incidents. Never takes a caller lock or releases a safety/STOP hold. */
export async function reconcileUnblockIncidents(sql: Database, now = new Date()): Promise<number> {
  return transaction(sql, async tx => {
    await tx`select id from unblock_availability where id='sole-operator' for update`;
    const blocked = await tx`update unblock_incidents i set blocked_at=coalesce(i.blocked_at,${now}),
      failure=coalesce(i.failure,case when m.message_id is null then 'alert_missing' when i.acknowledged_at is null and i.ack_due_at<=${now} then 'ack_overdue' else 'alert_failed' end)
      from (select i.id,m.id as message_id,m.status,m.attempts,m.reason,m.started_at from unblock_incidents i left join message_outbox m on m.id=i.alert_id) m
      where i.id=m.id and i.resolved_at is null and
        (i.blocked_at is not null or m.message_id is null or m.status in ('failed','uncertain','suppressed')
          or (m.status='pending' and m.attempts>0 and m.reason is not null)
          or (m.status='sending' and m.started_at<=${new Date(+now - 90_000)})
          or (i.acknowledged_at is null and i.ack_due_at<=${now})) returning i.id`;
    if (blocked.length) await tx`update unblock_availability set checked_in_at=null,expires_at=null,updated_at=${now} where id='sole-operator'`;
    await tx`delete from unblock_incidents where resolved_at<${new Date(+now - 30 * 86400_000)}`;
    return blocked.length;
  });
}

export async function acknowledgeUnblockIncident(sql: Database, id: string, now?: Date): Promise<void> {
  await reconcileUnblockIncidents(sql, now ?? new Date()); // A late acknowledgement cannot erase a missed target.
  await transaction(sql, async tx => {
    await tx`select id from unblock_availability where id='sole-operator' for update`;
    const at = now ?? new Date(); // CLI uses the clock after lock waits, never a backdated request time.
    await reconcileUnblockIncidents(tx, at);
    const [row] = await tx`update unblock_incidents set acknowledged_at=coalesce(acknowledged_at,${at}) where id=${id} and resolved_at is null returning id`;
    if (!row) throw Error('No open incident with that ID.');
  });
}

/** Explicit human attestation of completed private review; neither calls nor availability are resumed. */
export async function resolveUnblockIncident(sql: Database, id: string, now = new Date()): Promise<void> {
  await reconcileUnblockIncidents(sql, now);
  await transaction(sql, async tx => {
    await tx`select id from unblock_availability where id='sole-operator' for update`;
    const [row] = await tx`update unblock_incidents set resolved_at=${now} where id=${id} and acknowledged_at is not null and resolved_at is null returning alert_id`;
    if (!row) throw Error('Acknowledge an open incident and complete its private review first.');
    if (row['alert_id']) await tx`update message_outbox set status='suppressed',reason='incident_review_completed',payload_enc=null,recipient_enc=null where id=${row['alert_id']} and status='pending'`;
  });
}

/** Immediate alert attempt after the HTTP response; durable outbox/worker cover interruption. No caller content is logged. */
export async function dispatchUnblockIncidentAlerts(deps: LoopDeps, now = new Date()): Promise<void> {
  const rows = await deps.store.raw<{ id: string }[]>`select m.id from unblock_incidents i join message_outbox m on m.id=i.alert_id
    where i.resolved_at is null and m.status='pending' and m.available_at<=${now} order by i.created_at limit 50`;
  for (const row of rows) await dispatchMessage(deps, row.id, now);
  // Urgent receipt polling is separate from the general ten-minute receipt cadence.
  const accepted = await deps.store.raw<{ id: string; provider_id: string }[]>`select m.id,m.provider_id from unblock_incidents i join message_outbox m on m.id=i.alert_id
    where i.resolved_at is null and m.status='accepted' and m.provider_id is not null and m.checked_at<=${new Date(+now - 30_000)} limit 50`;
  for (const row of accepted) {
    if (!deps.sms.deliveryStatus) continue;
    await deps.store.raw`update message_outbox set checked_at=${now} where id=${row.id}`;
    try {
      const delivery = await deps.sms.deliveryStatus(row.provider_id);
      if (delivery !== 'pending') await deps.store.raw`update message_outbox set status=${delivery},delivered_at=${delivery === 'delivered' ? now : null},reason=${delivery === 'failed' ? 'provider_delivery_failed' : null} where id=${row.id} and status='accepted'`;
    } catch { /* No delivery or acknowledgement is inferred. */ }
  }
  await reconcileUnblockIncidents(deps.store.raw, now);
}
