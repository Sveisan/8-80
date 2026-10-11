import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { decrypt, encrypt } from '../store/crypto.ts';
import { phoneKey } from '../store/postgres.ts';
import type { Signup } from './form.ts';

const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

/** The code is never stored, only this. */
const codeKey = (phoneHash: string, code: string): string =>
  createHash('sha256').update(`${phoneHash}:${code}`).digest('hex');

export type Verdict =
  | { ok: true; signup: Signup }
  | { ok: false; why: 'unknown' | 'expired' | 'wrong' | 'too many' };

/**
 * Sign-ups that have not yet proved they own the number.
 *
 * The reason this table exists at all: a public form that writes straight to
 * `callers` places weekly phone calls to any number typed into it. Somebody
 * could enter an ex-partner's number and the product would ring them every
 * Tuesday morning in a warm, patient voice. Nothing reaches `callers` until a
 * code sent to the number comes back, and that is not a nicety, it is the
 * difference between a sign-up page and a harassment tool with a scheduler.
 *
 * One pending sign-up per number, replaced on each attempt. Somebody who
 * mistyped their own number and tried again should not be locked out by their
 * own first attempt, and a queue of pending rows per number is a way to send
 * somebody a hundred texts.
 */
export class Pending {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * Hold a sign-up and return the code to text them.
   *
   * The code is returned rather than sent from here, because this module must
   * not be able to send anything: a store that can text is a store that can be
   * made to text by anything that can write to it.
   */
  async start(signup: Signup, now = new Date()): Promise<string> {
    return (await this.begin(signup, now)).code;
  }

  async begin(signup: Signup, now = new Date(), onCreated?: (tx: postgres.TransactionSql, id: string, code: string) => Promise<void>, product = 'weekly'): Promise<{ id: string; code: string }> {
    const hash = phoneKey(signup.phone);
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${hash}, 1))`;
    await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
    await tx`
      insert into signups (
        id, product, phone_hash, phone_enc, email_enc, name, timezone,
        slot_weekday, slot_minute, code_hash, attempts, expires_at, created_at
      ) values (
        ${id}, ${product}, ${hash}, ${encrypt(signup.phone)}, ${signup.email ? encrypt(signup.email) : null}, ${signup.name},
        ${signup.timezone}, ${signup.weekday}, ${signup.minute}, ${codeKey(hash, code)}, 0,
        ${new Date(now.getTime() + TTL_MS)}, ${now}
      )
      on conflict (phone_hash, product) do update set
        id = excluded.id,
        product = excluded.product,
        phone_enc = excluded.phone_enc, email_enc = excluded.email_enc, name = excluded.name,
        timezone = excluded.timezone, slot_weekday = excluded.slot_weekday,
        slot_minute = excluded.slot_minute, code_hash = excluded.code_hash,
        attempts = 0, expires_at = excluded.expires_at, created_at = excluded.created_at
    `;
    await onCreated?.(tx, id, code);
    });
    return { id, code };
  }

  /**
   * Check a code, and on success hand back the sign-up and forget it.
   *
   * The attempt is counted before the comparison, so a client that hangs up
   * mid-request still spends one. Five is enough for somebody reading a text
   * on another screen and nowhere near enough for a million-wide code.
   */
  async verify(phone: string, code: string, now = new Date(), draftId?: string, onVerified?: (tx: postgres.TransactionSql, signup: Signup) => Promise<void>, product = 'weekly'): Promise<Verdict> {
    return await this.sql.begin<Verdict>(async (tx) => {
      const hash = phoneKey(phone);
      await tx`select pg_advisory_xact_lock(hashtextextended(${hash}, 1))`;
      await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
      const rows = await tx<
        { code_hash: string; attempts: number; expires_at: Date; phone_enc: string; email_enc: string | null; name: string | null; timezone: string; slot_weekday: number; slot_minute: number }[]
      >`
        update signups set attempts = attempts + 1
        where phone_hash = ${hash} and product = ${product} and (${draftId ?? null}::text is null or id = ${draftId ?? null})
        returning code_hash, attempts, expires_at, phone_enc, email_enc, name, timezone, slot_weekday, slot_minute
      `;
      const row = rows[0];
      if (!row) return { ok: false, why: 'unknown' };
      if (row.attempts > MAX_ATTEMPTS) return { ok: false, why: 'too many' };
      if (row.expires_at.getTime() <= now.getTime()) return { ok: false, why: 'expired' };

      const want = Buffer.from(row.code_hash, 'hex');
      const got = Buffer.from(codeKey(hash, code.replace(/\s/g, '')), 'hex');
      if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, why: 'wrong' };

      await tx`delete from signups where phone_hash = ${hash} and product = ${product}`;
      const signup = {
          phone: decrypt(row.phone_enc),
          email: row.email_enc ? decrypt(row.email_enc) : '',
          name: row.name ?? '',
          weekday: row.slot_weekday,
          minute: row.slot_minute,
          timezone: row.timezone,
        };
      await onVerified?.(tx, signup);
      return { ok: true, signup };
    });
  }

  /** Only an opaque draft capability may reveal the pre-verification form values. */
  async draft(id: string, now = new Date(), product = 'weekly'): Promise<Signup | undefined> {
    if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
    const [row] = await this.sql<{ phone_enc: string; email_enc: string | null; name: string | null; slot_weekday: number; slot_minute: number; timezone: string }[]>`
      select phone_enc, email_enc, name, slot_weekday, slot_minute, timezone from signups
      where id = ${id} and product = ${product} and created_at > ${new Date(now.getTime() - 3600_000)}
    `;
    return row ? { phone: decrypt(row.phone_enc), email: row.email_enc ? decrypt(row.email_enc) : '', name: row.name ?? '',
      weekday: row.slot_weekday, minute: row.slot_minute, timezone: row.timezone } : undefined;
  }

  async invalidate(id: string, now = new Date()): Promise<void> {
    await this.sql`update signups set expires_at = ${now} where id = ${id}`;
  }

  /** Housekeeping. An abandoned sign-up is somebody who changed their mind. */
  async prune(now = new Date()): Promise<number> {
    const gone = await this.sql<{ id: string }[]>`delete from signups where created_at < ${new Date(now.getTime() - 3600_000)} returning id`;
    return gone.length;
  }
}

export { MAX_ATTEMPTS, TTL_MS };
