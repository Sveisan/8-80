import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { TTL_MS, MAX_ATTEMPTS } from '../signup/pending.ts';

const HOUR = 3600_000;
const digest = (id: string, code: string): string => createHash('sha256').update(`access:${id}:${code}`).digest('hex');

/** Recovery has its own purpose and never writes signup, trial or schedule state. */
export class AccessCodes {
  constructor(private readonly sql: postgres.Sql) {}

  async start(phoneHash: string, now = new Date(), onCreated?: (tx: postgres.TransactionSql, id: string, code: string) => Promise<void>): Promise<{ id: string; code: string } | undefined> {
    return await this.sql.begin(async (tx) => {
      // Serialize first requests too, before a row exists. Limits survive restarts.
      await tx`select pg_advisory_xact_lock(hashtextextended(${phoneHash}, 0))`;
      await tx`select phone_hash from callers where phone_hash = ${phoneHash} for update`;
      const [row] = await tx<{ window_at: Date; sent_at: Date; sends: number }[]>`
        select window_at, sent_at, sends from access_codes where phone_hash = ${phoneHash}
      `;
      const inWindow = row && now.getTime() - row.window_at.getTime() < HOUR;
      if (row && (now.getTime() - row.sent_at.getTime() < 60_000 || (inWindow && row.sends >= 3))) return undefined;
      const id = randomUUID();
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx`
        insert into access_codes (phone_hash, id, code_hash, attempts, consumed, expires_at, window_at, sent_at, sends)
        values (${phoneHash}, ${id}, ${digest(id, code)}, 0, false, ${new Date(now.getTime() + TTL_MS)},
          ${inWindow ? row.window_at : now}, ${now}, ${inWindow ? row.sends + 1 : 1})
        on conflict (phone_hash) do update set id = excluded.id, code_hash = excluded.code_hash,
          attempts = 0, consumed = false, expires_at = excluded.expires_at,
          window_at = excluded.window_at, sent_at = excluded.sent_at, sends = excluded.sends
      `;
      await onCreated?.(tx, id, code);
      return { id, code };
    });
  }

  /** The update holds the row lock through consumption, so concurrent successes cannot replay it. */
  async verify(id: string, code: string, now = new Date()): Promise<string | undefined> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
    return await this.sql.begin(async (tx) => {
      const [identity] = await tx`select phone_hash from access_codes where id = ${id}`;
      if (!identity) return undefined;
      await tx`select phone_hash from callers where phone_hash = ${identity['phone_hash']} for update`;
      const [row] = await tx<{ phone_hash: string; code_hash: string }[]>`
        update access_codes set attempts = attempts + 1
        where id = ${id} and consumed = false and attempts < ${MAX_ATTEMPTS} and expires_at > ${now}
        returning phone_hash, code_hash
      `;
      if (!row) return undefined;
      const got = digest(id, code.replace(/\s/g, ''));
      if (!timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(got, 'hex'))) return undefined;
      await tx`update access_codes set consumed = true where id = ${id}`;
      return row.phone_hash;
    });
  }

  async invalidate(id: string): Promise<void> {
    await this.sql`update access_codes set consumed = true where id = ${id}`;
  }

  async prune(now = new Date()): Promise<void> {
    await this.sql`delete from access_codes where sent_at < ${new Date(now.getTime() - HOUR)}`;
  }
}
