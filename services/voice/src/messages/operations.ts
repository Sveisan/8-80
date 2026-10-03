import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';

/** Counts and identifiers only: never return addresses, codes or message bodies. */
export async function messageReport(sql: Database, now = new Date()) {
  const totals = await sql`select channel, kind, status, count(*)::int as count from message_outbox group by channel, kind, status order by channel, kind, status`;
  const attention = await sql`select id, channel, kind, status, reason, attempts, provider_id, created_at, expires_at from message_outbox
    where status in ('failed', 'uncertain') or (status = 'pending' and created_at < ${new Date(+now - 15 * 60_000)}) order by created_at limit 100`;
  return { totals, attention };
}

/** A deliberate operator decision, never a background retry of an ambiguous SMS. */
export async function resolveMessage(sql: Database, id: string, decision: 'retry-confirmed-not-accepted' | 'close-without-resend', now = new Date()): Promise<boolean> {
  return transaction(sql, async tx => {
    const [row] = await tx`select status, payload_enc, expires_at from message_outbox where id = ${id} for update`;
    if (!row || !['uncertain', 'failed'].includes(row['status'])) return false;
    const retry = decision === 'retry-confirmed-not-accepted';
    if (retry && (!row['payload_enc'] || row['expires_at'] <= now)) return false;
    await tx`update message_outbox set status = ${retry ? 'pending' : 'abandoned'}, reason = ${decision}, available_at = ${now},
      payload_enc = case when ${retry} then payload_enc else null end,
      recipient_enc = case when ${retry} then recipient_enc else null end where id = ${id}`;
    await tx`insert into message_attempts (id, message_id, started_at, finished_at, result)
      values (${crypto.randomUUID()}, ${id}, ${now}, ${now}, ${decision})`;
    return true;
  });
}
