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
  private readonly url: string;
  private readonly options: postgres.Options<Record<string, never>>;
  private rawClient: postgres.Sql | undefined;

  constructor(url: string, options: postgres.Options<Record<string, never>> = {}) {
    this.url = url;
    this.options = options;
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
  /**
   * Start somebody's free month.
   *
   * Separate from `upsertProfile` because a profile can be written a hundred
   * times and a trial exactly once: re-running it on an existing caller would
   * hand a second free month to anybody who signed up twice. The `where`
   * clause is the whole guard, and it lives in the statement rather than in a
   * read-then-write that two requests could interleave.
   */
  async startTrial(phone: string, endsAt: Date): Promise<boolean> {
    const rows = await this.raw<{ phone_hash: string }[]>`
      update callers set billing_status = 'trialing', trial_ends_at = ${endsAt}, updated_at = now()
      where phone_hash = ${phoneKey(phone)} and trial_ends_at is null and ls_subscription_id is null
      returning phone_hash
    `;
    return rows.length > 0;
  }

  /**
   * Record what the payments vendor says about somebody.
   *
   * Found by our own key first and by their subscription id second. The first
   * webhook for a new subscription is the only one that carries the phone hash
   * — it rides along in the checkout's custom data — so it is also the one
   * that writes the id every later webhook is found by.
   *
   * It never touches `paused`. See `claimDue`: that column is the caller's own
   * decision and billing is a different question asked in the same `where`.
   */
  async applyBilling(change: {
    phoneHash?: string;
    subscriptionId?: string;
    customerId?: string;
    standing?: 'active' | 'past_due' | 'ended';
  }): Promise<{ matched: boolean; from?: string; phoneHash?: string }> {
    if (!change.standing) return { matched: false };
    const status = change.standing;

    // A CTE rather than a subquery in RETURNING, because the old value is the
    // whole point and RETURNING's visibility rules are exactly the kind of
    // subtlety that works in testing and is wrong under load. `before` reads
    // and locks the row; `upd` writes it; the select joins them. There is no
    // version of this where the two disagree.
    //
    // The old status matters because Lemon Squeezy re-sends webhooks and
    // retries dunning: "is past_due" arrives many times, "has just become
    // past_due" once, and only the second is worth emailing somebody about.
    const rows = change.phoneHash
      ? await this.raw<{ phone_hash: string; was: string }[]>`
          with before as (
            select phone_hash, billing_status from callers where phone_hash = ${change.phoneHash} for update
          ), upd as (
            update callers set billing_status = ${status},
              ls_subscription_id = coalesce(${change.subscriptionId ?? null}, ls_subscription_id),
              ls_customer_id = coalesce(${change.customerId ?? null}, ls_customer_id),
              updated_at = now()
            where phone_hash = ${change.phoneHash}
            returning phone_hash
          )
          select upd.phone_hash, before.billing_status as was from upd join before on before.phone_hash = upd.phone_hash`
      : change.subscriptionId
        ? await this.raw<{ phone_hash: string; was: string }[]>`
            with before as (
              select phone_hash, billing_status from callers where ls_subscription_id = ${change.subscriptionId} for update
            ), upd as (
              update callers set billing_status = ${status}, updated_at = now()
              where ls_subscription_id = ${change.subscriptionId}
              returning phone_hash
            )
            select upd.phone_hash, before.billing_status as was from upd join before on before.phone_hash = upd.phone_hash`
        : [];
    const row = rows[0];
    return row ? { matched: true, from: row.was, phoneHash: row.phone_hash } : { matched: false };
  }

  /**
   * Trials that have run out, turned into a state that stops the calls.
   *
   * One transition and one email, ever, per caller: `billing_status` moves
   * from 'trialing' to 'ended' in the same statement that selects them, so two
   * sweeps running at once cannot both claim the same person and send two
   * emails about their trial.
   */
  async expireTrials(now = new Date()): Promise<{ phoneHash: string }[]> {
    const rows = await this.raw<{ phone_hash: string }[]>`
      update callers set billing_status = 'ended', updated_at = now()
      where billing_status = 'trialing' and trial_ends_at is not null and trial_ends_at <= ${now}
      returning phone_hash
    `;
    return rows.map((r) => ({ phoneHash: r.phone_hash }));
  }

  /**
   * Erase somebody, completely.
   *
   * Every table that knows their hash, in one transaction, including the
   * webhook deliveries whose encrypted bodies are their transcripts. Not a
   * flag, not a tombstone, not a row with the columns blanked: privacy.md says
   * "it cannot be undone and it is not a deactivation", and a soft delete
   * would make that sentence a lie in a document that exists to be true.
   *
   * The attempt history goes too. It is keyed on the hash, so keeping it would
   * leave a record of when a named person was rung, which is exactly the thing
   * they asked to be rid of.
   */
  async forget(phone: string): Promise<boolean> {
    const hash = phoneKey(phone);
    return await this.raw.begin(async (tx) => {
      await tx`delete from links where phone_hash = ${hash}`;
      await tx`delete from signups where phone_hash = ${hash}`;
      await tx`delete from webhook_deliveries where conversation_id in (
        select provider_call_id from call_attempts where phone_hash = ${hash} and provider_call_id is not null
      )`;
      await tx`delete from call_attempts where phone_hash = ${hash}`;
      const gone = await tx<{ phone_hash: string }[]>`delete from callers where phone_hash = ${hash} returning phone_hash`;
      return gone.length > 0;
    });
  }

  async phoneFor(phoneHash: string): Promise<string | undefined> {
    const rows = await this.db
      .select({ enc: callers.phoneEnc })
      .from(callers)
      .where(sql`${callers.phoneHash} = ${phoneHash}`)
      .limit(1);
    return rows[0] ? decrypt(rows[0].enc) : undefined;
  }

  /**
   * A client for hand-written SQL — deliberately not the one drizzle wraps.
   *
   * Drizzle installs its own serialisers on the postgres.js instance it is
   * given, and a Date passed to a raw tagged query on that instance is then
   * written as a string and throws inside the driver. Nothing says so; the
   * error is ERR_INVALID_ARG_TYPE from Buffer.byteLength, several frames deep.
   *
   * It stayed hidden for a while because the tests build their scheduler from
   * their own client, so every test passed while the deployed process could not
   * set a slot at all. A second small pool is a cheap price for the two never
   * touching each other again.
   */
  get raw(): postgres.Sql {
    this.rawClient ??= postgres(this.url, { max: 4, ...this.options });
    return this.rawClient;
  }

  async close(): Promise<void> {
    await Promise.all([this.sqlClient.end({ timeout: 5 }), this.rawClient?.end({ timeout: 5 })]);
  }
}
