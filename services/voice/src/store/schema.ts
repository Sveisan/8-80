import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * One row per caller. Deliberately small — see `CallerRecord`.
 *
 * Two rules shape every column here.
 *
 * A caller is identified by their phone number, and a table keyed on plaintext
 * numbers is a phone book: one over-broad query and it is a list of everyone
 * who uses this. So the number is stored twice — `phoneHash` is a SHA-256 of
 * the E.164 number and is what we look up by, and `phoneEnc` is the number
 * itself, encrypted, because at some point we have to actually dial it. The
 * hash is deterministic, which is the whole point and also its limit: it is a
 * lookup key, not a secret, and anyone holding a number can confirm whether it
 * is in here. That is acceptable for a key and would not be for the contents.
 *
 * And what the caller said is encrypted before it reaches this table rather
 * than by the disk underneath it, because the realistic failure is a
 * compromised application or a query that returns too much, and neither is
 * stopped by an encrypted volume.
 */
export const callers = pgTable(
  'callers',
  {
    phoneHash: text('phone_hash').primaryKey(),
    /** E.164, encrypted. The only way back to a number we can ring. */
    phoneEnc: text('phone_enc').notNull(),
    name: text('name'),
    language: text('language'),
    /** 'female' | 'male' | a provider voice name. Their choice, not a default. */
    voice: text('voice'),
    /** This is call number N. 1 means they have never been called. */
    callNumber: integer('call_number').notNull().default(1),
    /** What they said they would do, in their own words. Encrypted. */
    lastCommitmentEnc: text('last_commitment_enc'),
    /** The day they named. A weekday name on its own tells nobody anything. */
    lastCommitmentDay: text('last_commitment_day'),
    consecutiveUndone: integer('consecutive_undone').notNull().default(0),
    patienceOffsetMs: integer('patience_offset_ms'),
    lastCallAt: timestamp('last_call_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('callers_phone_hash_key').on(t.phoneHash), index('callers_last_call_at_idx').on(t.lastCallAt)],
);

export type CallerRow = typeof callers.$inferSelect;
