import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { log } from '../log.ts';
import { decrypt, encrypt, hasKey } from './crypto.ts';
import { callers } from './schema.ts';
import type { CallerRecord, CallOutcome, Store } from './types.ts';

/** The lookup key for a number. Deterministic on purpose; see schema.ts. */
export function phoneKey(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

/**
 * A caller's memory in Postgres.
 *
 * The one behaviour worth reading closely is `record`. `FileStore` loads, adds
 * one, and writes back, which is fine for a single caller on a laptop and
 * wrong the moment two calls overlap: both read call number 4, both write 5,
 * and a week disappears. Here the increment happens in the database, in the
 * same statement as the insert, so concurrency cannot lose one.
 *
 * That forces a small awkwardness. A call that reached no commitment must not
 * overwrite the previous one — they are still on the hook for what they said
 * last week — and expressing "keep the old value if the new one is null" in an
 * upsert means `coalesce(excluded.x, callers.x)`. It reads worse than the file
 * version and it is the reason the file version is not the one that ships.
 */
export class PostgresStore implements Store {
  private readonly db: PostgresJsDatabase;
  private readonly sqlClient: postgres.Sql;

  constructor(url: string, options: postgres.Options<Record<string, never>> = {}) {
    this.sqlClient = postgres(url, { max: 4, ...options });
    this.db = drizzle(this.sqlClient);
  }

  async load(phone: string): Promise<CallerRecord> {
    const rows = await this.db
      .select()
      .from(callers)
      .where(sql`${callers.phoneHash} = ${phoneKey(phone)}`)
      .limit(1);
    const row = rows[0];
    // No record is not an error: it is the first call.
    if (!row) return { phone, callNumber: 1, consecutiveUndone: 0 };

    return {
      phone,
      name: row.name ?? undefined,
      email: row.emailEnc ? decrypt(row.emailEnc) : undefined,
      language: row.language ?? undefined,
      voice: row.voice ?? undefined,
      callNumber: row.callNumber,
      lastCommitment: row.lastCommitmentEnc ? decrypt(row.lastCommitmentEnc) : undefined,
      lastCommitmentDay: row.lastCommitmentDay ?? undefined,
      consecutiveUndone: row.consecutiveUndone,
      patienceOffsetMs: row.patienceOffsetMs ?? undefined,
    };
  }

  async record(phone: string, outcome: CallOutcome): Promise<void> {
    // Refusing to write is the failure mode we want: it costs us a feature,
    // where writing in the clear would cost them a confidence.
    if (outcome.commitment && !hasKey()) {
      log('store.not_written', {
        reason: 'DATA_ENCRYPTION_KEY is unset, and what they said is not going to disk in the clear',
      });
      return;
    }

    const key = phoneKey(phone);
    const commitment = outcome.commitment ? encrypt(outcome.commitment) : null;
    const at = new Date(outcome.at);

    await this.db
      .insert(callers)
      .values({
        phoneHash: key,
        phoneEnc: encrypt(phone),
        callNumber: 2,
        lastCommitmentEnc: commitment,
        lastCommitmentDay: outcome.day ?? null,
        lastCallAt: at,
      })
      .onConflictDoUpdate({
        target: callers.phoneHash,
        set: {
          callNumber: sql`${callers.callNumber} + 1`,
          // A call that reached no commitment leaves the last one standing.
          lastCommitmentEnc: sql`coalesce(${commitment}, ${callers.lastCommitmentEnc})`,
          lastCommitmentDay: sql`coalesce(${outcome.day ?? null}, ${callers.lastCommitmentDay})`,
          lastCallAt: at,
          updatedAt: sql`now()`,
        },
      });

    log('store.recorded', { commitment: outcome.commitment ? 'set' : 'none' });
  }

  /** Only the caller's own fields — never anything the call produced. */
  async upsertProfile(
    phone: string,
    profile: Pick<CallerRecord, 'name' | 'language' | 'voice' | 'email'>,
  ): Promise<void> {
    if (!hasKey()) throw new Error('DATA_ENCRYPTION_KEY is required to store a phone number');
    const { email, ...rest } = profile;
    const fields = { ...rest, ...(email === undefined ? {} : { emailEnc: encrypt(email) }) };
    await this.db
      .insert(callers)
      .values({ phoneHash: phoneKey(phone), phoneEnc: encrypt(phone), ...fields })
      .onConflictDoUpdate({
        target: callers.phoneHash,
        set: { ...fields, updatedAt: sql`now()` },
      });
  }

  /** The number we can actually ring, for a caller the scheduler found by key. */
  async phoneFor(phoneHash: string): Promise<string | undefined> {
    const rows = await this.db
      .select({ enc: callers.phoneEnc })
      .from(callers)
      .where(sql`${callers.phoneHash} = ${phoneHash}`)
      .limit(1);
    return rows[0] ? decrypt(rows[0].enc) : undefined;
  }

  async close(): Promise<void> {
    await this.sqlClient.end({ timeout: 5 });
  }
}
