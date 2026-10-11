import { randomUUID } from 'node:crypto';
import type { Database } from '../store/transaction.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import type { LoopDeps } from '../loop/deps.ts';
import type { Recap } from '../recap/compose.ts';
import type { Sms } from '../sms/types.ts';
import { OptedOut } from '../sms/types.ts';
import type { Mailer } from '../recap/mailer.ts';
import { SendFailure } from './types.ts';

export type MessageKind = 'call' | 'welcome' | 'recap' | 'billing' | 'trial' | 'feedback' | 'access' | 'signup' | 'reply' | 'export' | 'beliefs' | 'safety';
export interface Message {
  eventKey: string; phoneHash: string; channel: 'sms' | 'email'; kind: MessageKind;
  to: string; body: string | Recap; reference?: string; expiresAt?: Date;
}
type Row = { id: string; event_key: string; phone_hash: string; channel: 'sms' | 'email'; kind: MessageKind; reference: string | null;
  recipient_enc: string | null; payload_enc: string | null; status: string; attempts: number; created_at: Date; expires_at: Date;
  first_attempt_at: Date | null; started_at: Date | null; provider_id: string | null; accepted_at: Date | null };
const HOUR = 3600_000;

/** Must be called in the same transaction as the change that owes this notice. */
export async function enqueue(sql: Database, message: Message, now = new Date()): Promise<string> {
  const expires = message.expiresAt ?? new Date(+now + (message.channel === 'sms' ? 6 : 23) * HOUR);
  const guardSchedule = ['call', 'welcome', 'reply'].includes(message.kind);
  const [caller] = guardSchedule ? await sql`select next_call_at from callers where phone_hash = ${message.phoneHash}` : [];
  const payload = { body: message.body, ...(guardSchedule ? { appointment: caller?.['next_call_at']?.toISOString() ?? null } : {}) };
  await sql`insert into message_outbox (id, event_key, phone_hash, channel, kind, reference, recipient_enc, payload_enc, created_at, available_at, expires_at)
    values (${randomUUID()}, ${message.eventKey}, ${message.phoneHash}, ${message.channel}, ${message.kind}, ${message.reference ?? null},
      ${encrypt(message.to)}, ${encrypt(JSON.stringify(payload))}, ${now}, ${now}, ${expires}) on conflict (event_key) do nothing`;
  const [row] = await sql<{ id: string }[]>`select id from message_outbox where event_key = ${message.eventKey}`;
  return row!.id;
}

/** Adapters for an atomic producer: these record intent and never contact a provider. */
export function queued(sql: Database, phoneHash: string, scope: string, now: Date, smsKind: MessageKind = 'call', reference?: string): { sms: Sms; mailer: Mailer; ids: string[] } {
  const ids: string[] = [];
  return {
    ids,
    sms: { transactional: true, async send(to, body) { ids.push(await enqueue(sql, { eventKey: `${scope}:sms`, phoneHash, channel: 'sms', kind: smsKind, to, body, reference }, now)); } },
    mailer: { async send(to, body) { ids.push(await enqueue(sql, { eventKey: `${scope}:email`, phoneHash, channel: 'email', kind: 'recap', to, body, reference }, now)); } },
  };
}

/** A send request with no final result is never silently assumed to have failed. */
export async function recoverMessages(deps: LoopDeps, now = new Date()): Promise<void> {
  const safeWindow = Math.max(0, (deps.mailer.retryWindowMs ?? 0) - 60_000);
  await deps.store.raw`update message_outbox set
    status = case when channel = 'email' and first_attempt_at > ${new Date(+now - safeWindow)} and expires_at > ${now} then 'pending' else 'uncertain' end,
    reason = 'worker_interrupted', available_at = ${now}
    where status = 'sending' and started_at < ${new Date(+now - 90_000)}`;
  await deps.store.raw`update message_attempts set result = 'interrupted', finished_at = ${now}
    where finished_at is null and started_at < ${new Date(+now - 90_000)}`;
}

/** Suppression is rechecked under the same caller lock used by deletion and controls. */
async function suppression(sql: Database, row: Row, now: Date): Promise<string | undefined> {
  if (row.expires_at <= now) return 'expired';
  const [caller] = await sql`select email_enc, next_call_at, paused, held_for_review, sms_opt_out, feedback_opt_out, billing_status, cancel_at_period_end, ls_subscription_id from callers where phone_hash = ${row.phone_hash} for update`;
  if (row.kind === 'signup' || row.kind === 'access') {
    const valid = row.kind === 'signup'
      ? await sql`select id from signups where phone_hash = ${row.phone_hash} and id = ${row.reference} and expires_at > ${now} for update`
      : await sql`select id from access_codes where phone_hash = ${row.phone_hash} and id = ${row.reference} and consumed = false and expires_at > ${now} for update`;
    if (!valid.length || (row.kind === 'access' && !caller)) return 'superseded_code';
  } else if (!caller) return 'account_deleted';
  const payload = row.payload_enc ? JSON.parse(decrypt(row.payload_enc)) as { appointment?: string | null } : undefined;
  if (payload && 'appointment' in payload && payload.appointment !== (caller?.['next_call_at']?.toISOString() ?? null)) return 'appointment_changed';
  if (row.kind !== 'safety' && row.channel === 'email' && row.recipient_enc && (!caller?.['email_enc'] || decrypt(row.recipient_enc) !== decrypt(caller['email_enc']))) return 'address_changed';
  if (row.kind !== 'safety' && row.channel === 'sms' && caller?.['sms_opt_out']) return 'carrier_opt_out';
  if (['call', 'welcome', 'feedback'].includes(row.kind) && caller?.['paused']) return 'calls_paused';
  if (row.kind === 'beliefs' && caller?.['held_for_review']) return 'human_review';
  if (row.kind === 'trial' && (caller?.['billing_status'] !== 'ended' || caller?.['ls_subscription_id'])) return 'trial_state_changed';
  if (row.kind === 'billing' && row.reference !== `${caller?.['billing_status']}:${caller?.['cancel_at_period_end']}`) return 'billing_state_changed';
  if (row.kind === 'call' && row.reference) {
    const flagged = await sql`select id from call_attempts where id = ${row.reference} and safety_tier is not null`;
    if (flagged.length) return 'human_review';
  }
  if (row.kind === 'feedback') {
    if (caller?.['feedback_opt_out']) return 'feedback_opt_out';
    const flagged = await sql`select id from call_attempts where phone_hash = ${row.phone_hash} and safety_tier is not null limit 1`;
    if (flagged.length) return 'human_review';
    const recent = await sql`select id from message_outbox where phone_hash = ${row.phone_hash} and channel = 'sms' and id <> ${row.id}
      and (accepted_at > ${new Date(+now - 30 * 60_000)} or (status = 'sending' and started_at > ${new Date(+now - 30 * 60_000)})) limit 1`;
    if (recent.length) return 'wait_for_spacing';
  }
  return undefined;
}

/** Returns the durable outcome; accepted means the provider took responsibility, not delivery. */
export async function dispatchMessage(deps: LoopDeps, id: string, now = new Date()): Promise<string> {
  const sql = deps.store.raw;
  const attemptId = randomUUID();
  const claimed = await sql.begin(async tx => {
    const [row] = await tx<Row[]>`update message_outbox set status = 'sending', started_at = ${now},
      first_attempt_at = coalesce(first_attempt_at, ${now}), attempts = attempts + 1
      where id = (select id from message_outbox where id = ${id} and status = 'pending' and available_at <= ${now} for update skip locked) returning *`;
    if (row) await tx`insert into message_attempts (id, message_id, started_at) values (${attemptId}, ${id}, ${now})`;
    return row;
  });
  if (!claimed) return (await sql`select status from message_outbox where id = ${id}`)[0]?.['status'] ?? 'missing';
  // Claim is committed before I/O. A crash during the following transaction
  // leaves an identifiable in-flight request for bounded retry or review.
  return await sql.begin(async tx => {
    const reason = await suppression(tx, claimed, now);
    const [row] = await tx<Row[]>`select * from message_outbox where id = ${id} and status = 'sending' for update`;
    if (!row) return 'missing';
    const finish = async (status: string, why?: string): Promise<string> => {
      await tx`update message_outbox set status = ${status}, reason = ${why ?? null},
        available_at = ${new Date(+now + Math.min(30 * 60_000, 60_000 * 2 ** Math.min(row.attempts - 1, 5)))},
        recipient_enc = case when ${['accepted', 'suppressed'].includes(status)} then null else recipient_enc end,
        payload_enc = case when ${['accepted', 'suppressed'].includes(status)} then null else payload_enc end where id = ${id}`;
      await tx`update message_attempts set result = ${why ?? status}, finished_at = ${now} where id = ${attemptId}`;
      if (row.kind === 'feedback') await tx`update feedback set state = ${status === 'accepted' ? 'sent' : status === 'pending' ? 'queued' : 'failed'},
        sent_at = case when ${status === 'accepted'} then ${now} else sent_at end where phone_hash = ${row.phone_hash}`;
      return status;
    };
    if (reason) return finish(reason === 'wait_for_spacing' ? 'pending' : 'suppressed', reason);
    const transport = row.channel === 'email' ? deps.mailer : deps.sms;
    if (transport.previewOnly) return finish('failed', 'provider_unconfigured');
    if (row.attempts > 1 && transport.retryWindowMs && row.first_attempt_at && +now - +row.first_attempt_at >= transport.retryWindowMs - 60_000) return finish('uncertain', 'idempotency_window_expired');
    try {
      const to = decrypt(row.recipient_enc!);
      const body = (JSON.parse(decrypt(row.payload_enc!)) as { body: string | Recap }).body;
      const receipt = row.channel === 'email'
        ? await deps.mailer.send(to, body as Recap, { idempotencyKey: `8and80/${id}` })
        : await deps.sms.send(to, body as string, { idempotencyKey: `8and80/${id}` });
      await tx`update message_outbox set provider_id = ${receipt?.id ?? null}, accepted_at = ${now}, checked_at = ${now} where id = ${id}`;
      if (row.channel === 'sms' && row.kind === 'call' && row.reference) await tx`update call_attempts set sms_sent_at = ${now} where id = ${row.reference}`;
      return finish('accepted');
    } catch (error) {
      if (error instanceof OptedOut && row.kind !== 'safety') {
        await tx`update callers set paused = true, all_calls_stopped = true, sms_opt_out = true where phone_hash = ${row.phone_hash}`;
        return finish('suppressed', 'carrier_opt_out');
      }
      const disposition = error instanceof SendFailure ? error.disposition : transport.retryWindowMs ? 'retry' : 'uncertain';
      const retry = disposition === 'retry' && row.attempts < 8;
      return finish(retry ? 'pending' : disposition === 'permanent' || disposition === 'retry' ? 'failed' : 'uncertain', disposition === 'retry' && !retry ? 'retries_exhausted' : disposition);
    }
  });
}

export async function dispatchMessages(deps: LoopDeps, now = new Date()): Promise<void> {
  await recoverMessages(deps, now);
  const rows = await deps.store.raw<{ id: string }[]>`select id from message_outbox where status = 'pending' and available_at <= ${now} order by created_at, id limit 50`;
  for (const row of rows) await dispatchMessage(deps, row.id, now);
  await reconcileMessages(deps, now);
  // Clear pending secrets promptly; terminal metadata lasts 30 days for diagnosis.
  await deps.store.raw`update message_outbox set payload_enc = null, recipient_enc = null,
    status = case when status = 'pending' then 'failed' else status end, reason = coalesce(reason, 'expired')
    where expires_at <= ${now} and status <> 'sending' and payload_enc is not null`;
  await deps.store.raw`delete from message_attempts where message_id in (select id from message_outbox where created_at < ${new Date(+now - 30 * 24 * HOUR)})`;
  await deps.store.raw`delete from message_outbox where created_at < ${new Date(+now - 30 * 24 * HOUR)} and status <> 'sending'`;
}

/** Poll receipts without tracking email opens or clicks. No request is resent here. */
export async function reconcileMessages(deps: LoopDeps, now = new Date()): Promise<void> {
  const rows = await deps.store.raw<Row[]>`select * from message_outbox where status = 'accepted' and provider_id is not null
    and accepted_at > ${new Date(+now - 48 * HOUR)} and checked_at <= ${new Date(+now - 10 * 60_000)} order by checked_at limit 50`;
  for (const row of rows) {
    const transport = row.channel === 'email' ? deps.mailer : deps.sms;
    if (!transport.deliveryStatus) continue;
    await deps.store.raw`update message_outbox set checked_at = ${now} where id = ${row.id}`;
    try {
      const status = await transport.deliveryStatus(row.provider_id!);
      if (status !== 'pending') await deps.store.raw`update message_outbox set status = ${status},
        delivered_at = ${status === 'delivered' ? now : null}, reason = ${status === 'failed' ? 'provider_delivery_failed' : null} where id = ${row.id} and status = 'accepted'`;
    } catch { /* Retain accepted, with no false delivery claim. Retry the status check later. */ }
  }
}
