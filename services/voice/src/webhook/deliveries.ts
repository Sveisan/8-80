import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { encrypt, decrypt, hasKey } from '../store/crypto.ts';
import { log } from '../log.ts';

/**
 * Fourteen days. Long enough to debug last week's call, short enough that this
 * never becomes the file on somebody that `CallerRecord` promises not to keep.
 */
const RETENTION_MS = Number(process.env['DELIVERY_RETENTION_DAYS'] ?? 14) * 24 * 3600_000;

export interface StoredDelivery {
  id: string;
  event: string | null;
  conversationId: string | null;
  verdict: string | null;
  receivedAt: Date;
}

/**
 * The webhook deliveries we have accepted, kept briefly so they can be replayed.
 *
 * Everything here is written before the payload is understood, because the
 * deliveries worth keeping are the ones we could not read. See the table's own
 * comment in store/schema.ts for why it is encrypted and why it is pruned.
 */
export class Deliveries {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * Never lets a storage failure cost us a webhook. This is a debugging aid,
   * and a debugging aid that can 500 a real delivery is worse than no debugging
   * aid: the call it was meant to help us understand would be the one it lost.
   */
  async record(
    body: Buffer,
    meta: { deliveryId?: string; event?: string },
  ): Promise<string | undefined> {
    if (!hasKey()) return undefined;
    const id = meta.deliveryId ?? randomUUID();
    try {
      // The conversation id is pulled out for lookup only, and only if it is
      // exactly where we expect it. A delivery we cannot read still gets
      // stored — with a null here — which is the whole point of the table.
      const conversationId = peekConversationId(body);
      await this.sql`
        insert into webhook_deliveries (id, event, conversation_id, body_enc)
        values (${id}, ${meta.event ?? null}, ${conversationId ?? null}, ${encrypt(body.toString('utf8'))})
        on conflict (id) do update set received_at = now()
      `;
      return id;
    } catch (e) {
      log('delivery.not_stored', { reason: (e as Error).message });
      return undefined;
    }
  }

  /** What we made of it, written after the fact. Also never fatal. */
  async verdict(id: string | undefined, verdict: string): Promise<void> {
    if (!id) return;
    // This column is not encrypted — it is our own word for what happened, and
    // it is what `doctor` prints on a screen somebody else can see. An
    // unreadable-payload message quotes the offending field back, which is
    // payload text, so it is trimmed to something that cannot carry a sentence.
    verdict = verdict.slice(0, 120);
    try {
      await this.sql`update webhook_deliveries set verdict = ${verdict} where id = ${id}`;
    } catch (e) {
      log('delivery.verdict_not_stored', { reason: (e as Error).message });
    }
  }

  async list(limit = 20): Promise<StoredDelivery[]> {
    const rows = await this.sql<
      { id: string; event: string | null; conversation_id: string | null; verdict: string | null; received_at: Date }[]
    >`
      select id, event, conversation_id, verdict, received_at
      from webhook_deliveries order by received_at desc limit ${limit}
    `;
    return rows.map((r) => ({
      id: r.id,
      event: r.event,
      conversationId: r.conversation_id,
      verdict: r.verdict,
      receivedAt: r.received_at,
    }));
  }

  /** The body as it arrived, byte for byte, for code that must see what we saw. */
  async body(idOrConversation: string): Promise<{ id: string; event: string | null; body: string } | undefined> {
    const rows = await this.sql<{ id: string; event: string | null; body_enc: string }[]>`
      select id, event, body_enc from webhook_deliveries
      where id = ${idOrConversation} or conversation_id = ${idOrConversation}
      order by received_at desc limit 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    return { id: row.id, event: row.event, body: decrypt(row.body_enc) };
  }

  /** Older than the retention window, gone. Returns how many. */
  async prune(now = new Date(), retentionMs = RETENTION_MS): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionMs).toISOString();
    const gone = await this.sql<{ id: string }[]>`
      delete from webhook_deliveries where received_at < ${cutoff} returning id
    `;
    return gone.length;
  }
}

/**
 * The conversation id, if it is exactly where we expect it, for lookup only.
 *
 * Deliberately shallow and deliberately silent: `toTranscript` is the thing
 * that decides whether a payload is readable, and a second, laxer parser here
 * would be a second opinion nobody asked for. A null just means "look it up by
 * delivery id instead".
 */
function peekConversationId(body: Buffer): string | undefined {
  try {
    const p = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const data = p['data'] as Record<string, unknown> | undefined;
    const object = data?.['object'] as Record<string, unknown> | undefined;
    const id = object?.['id'] ?? object?.['conversation_id'] ?? p['conversation_id'];
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}
