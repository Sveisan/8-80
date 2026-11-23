import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from '../config.ts';
import { enqueue } from '../messages/outbox.ts';
import { nextSlotAfter, type Slot } from '../schedule/time.ts';
import type { Answer } from '../signup/routes.ts';
import { decrypt } from '../store/crypto.ts';
import { transaction, type Database } from '../store/transaction.ts';
import { pilotFollowupApproved, pilotFollowupLetter, pilotFollowupVersion } from './pilot-followup-copy.ts';

const hour = 3600_000;
const timing = { before: { start: -24, end: -6 }, after: { start: 48, end: 72 } } as const;

/** The consent is bound to the address supplied in this verified pilot signup. */
export async function rememberPilotOptIn(sql: Database, phoneHash: string, now: Date): Promise<void> {
  await sql`insert into weekly_pilot_followups (phone_hash, id, consented_at, consent_version, email_enc)
    select phone_hash, ${randomUUID()}, ${now}, ${pilotFollowupVersion}, email_enc from callers
    where phone_hash = ${phoneHash} and weekly_offer = 'pilot' and email_enc is not null
    on conflict (phone_hash) do nothing`;
}

export async function armPilotFollowup(sql: Database, phoneHash: string, slot: Slot, now: Date): Promise<void> {
  const next = nextSlotAfter(now, slot);
  await sql`update weekly_pilot_followups set next_slot_at = ${next}
    where phone_hash = ${phoneHash} and consent_version = ${pilotFollowupVersion} and revoked_at is null and next_slot_at is null`;
}

export async function queuePilotFollowups(sql: Database, now = new Date()): Promise<void> {
  if (!pilotFollowupApproved()) return;
  await sql`update weekly_pilot_followups set email_enc = null where email_enc is not null and
    (next_slot_at <= ${new Date(+now - timing.after.end * hour)} or consented_at <= ${new Date(+now - 45 * 24 * hour)})`;
  const base = config.link.publicUrl().replace(/\/$/, '');
  if (!base.startsWith('https://')) return;
  for (const stage of ['before', 'after'] as const) {
    const { start, end } = timing[stage];
    const rows = await sql<{ id: string; phone_hash: string; email_enc: string; name: string | null; next_slot_at: Date }[]>`
      select f.id,c.phone_hash,c.email_enc,c.name,f.next_slot_at from weekly_pilot_followups f join callers c using (phone_hash)
      where f.consent_version = ${pilotFollowupVersion} and f.revoked_at is null and f.feedback is null
        and f.email_enc = c.email_enc and c.weekly_offer = 'pilot' and c.weekly_free_calls_used = 1
        and c.billing_status = 'ended' and c.ls_subscription_id is null and not c.held_for_review
        and not c.all_calls_stopped and not c.paused
        and f.next_slot_at > ${new Date(+now - end * hour)} and f.next_slot_at <= ${new Date(+now - start * hour)}
        and not exists (select 1 from message_outbox where event_key = 'weekly-pilot-followup:' || f.id || ':' || ${stage})`;
    for (const row of rows) await enqueue(sql, { eventKey: `weekly-pilot-followup:${row.id}:${stage}`, kind: 'pilot-followup', channel: 'email',
      reference: row.id, phoneHash: row.phone_hash, to: decrypt(row.email_enc), body: pilotFollowupLetter(stage, base, row.id, row.name),
      expiresAt: new Date(Math.min(+now + 22 * hour, +row.next_slot_at + end * hour)) }, now);
  }
}

const reasons = ['I already took a step', 'A smaller first step', 'Making time for it', 'I’m still working out what I want'] as const;

export async function pilotFollowupRoute(req: IncomingMessage, url: URL, sql: Database): Promise<Answer | undefined> {
  const match = /^\/pilot-followup\/([a-f0-9-]{36})\/(unsubscribe|feedback)$/.exec(url.pathname);
  if (!match || (req.method !== 'GET' && req.method !== 'POST')) return undefined;
  const id = match[1]!;
  const action = match[2];
  const unsubscribe = action === 'unsubscribe';
  const title = unsubscribe ? 'Unsubscribe from 8&80 follow-ups' : 'A quick question about your 8&80 call';
  const page = (body: string, status = 200): Answer => ({ status, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>` });
  if (req.method === 'GET') return unsubscribe
    ? page('<form method="post"><button type="submit">Unsubscribe</button></form>')
    : page(`<p>What would help you take the next step?</p><form method="post">${reasons.map((reason, index) =>
      `<p><button name="reason" value="${index}">${reason}</button></p>`).join('')}</form>`);

  let reason: typeof reasons[number] | undefined;
  if (!unsubscribe) {
    let payload = '';
    for await (const chunk of req) {
      payload += String(chunk);
      if (payload.length > 128) return page('<p>Choose one answer.</p>', 400);
    }
    const key = new URLSearchParams(payload).get('reason');
    if (!key || !/^[0-3]$/.test(key)) return page('<p>Choose one answer.</p>', 400);
    reason = reasons[Number(key)];
  }
  await transaction(sql, async tx => {
    // Share the outbox's lock order. Once withdrawal returns, no new send can claim consent.
    const [row] = await tx`select phone_hash from weekly_pilot_followups where id = ${id}`;
    if (!row) return;
    await tx`select phone_hash from callers where phone_hash = ${row['phone_hash']} for update`;
    if (unsubscribe) await tx`update weekly_pilot_followups set revoked_at = coalesce(revoked_at, now()), email_enc = null where id = ${id}`;
    else await tx`update weekly_pilot_followups set feedback = coalesce(feedback, ${reason!}) where id = ${id} and next_slot_at is not null`;
  });
  return page(unsubscribe ? '<p>You’re unsubscribed from these follow-ups.</p>' : '<p>Thanks for sharing where you are.</p>');
}
