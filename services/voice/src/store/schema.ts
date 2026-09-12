import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
    /** Where the recap goes. Encrypted — an address is as identifying as a number. */
    emailEnc: text('email_enc'),
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

    /*
     * The weekly slot, in the caller's own terms rather than in UTC. See
     * schedule/time.ts: a slot held as a UTC instant and advanced by seven days
     * arrives an hour early one week in spring and an hour late one week in
     * autumn, and a call whose whole proposition is that it turns up when it
     * said it would cannot do that.
     */
    timezone: text('timezone'),
    /** 0 = Sunday. */
    slotWeekday: integer('slot_weekday'),
    /** Minutes past local midnight. */
    slotMinute: integer('slot_minute'),
    /** When the slot next comes round, derived from the three fields above. */
    nextCallAt: timestamp('next_call_at', { withTimezone: true }),
    /** Their choice to stop, which is not the same as having no slot. */
    paused: boolean('paused').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('callers_phone_hash_key').on(t.phoneHash),
    index('callers_last_call_at_idx').on(t.lastCallAt),
    index('callers_due_idx').on(t.nextCallAt),
  ],
);

/**
 * One row per call the scheduler decided to make.
 *
 * This table exists to make the decision idempotent. The unique key is the
 * caller and the moment the slot was due, so a scheduler that restarts, or two
 * of them running at once, cannot ring the same person twice for the same
 * Tuesday: the second insert conflicts and does nothing. The claim is taken in
 * the same transaction that moves the caller's slot forward, so the two can
 * never disagree about whether this week happened.
 *
 * `status` therefore distinguishes three different failures that look alike
 * from outside: we never placed the call, we placed it and it did not connect,
 * or it connected and nobody could hear anything — which is the one the vendor
 * reports as success.
 */
export const callAttempts = pgTable(
  'call_attempts',
  {
    id: text('id').primaryKey(),
    phoneHash: text('phone_hash').notNull(),
    /** The slot instant this attempt is for — not when it was placed. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    /** claimed → placed → (completed | silent | failed). */
    status: text('status').notNull().default('claimed'),
    /** Whatever the voice platform calls this conversation, for their logs. */
    providerCallId: text('provider_call_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    /** Why it failed, in our words. Never anything the caller said. */
    note: text('note'),
  },
  (t) => [
    uniqueIndex('call_attempts_slot_key').on(t.phoneHash, t.scheduledFor),
    index('call_attempts_status_idx').on(t.status, t.claimedAt),
  ],
);

export type CallerRow = typeof callers.$inferSelect;
export type CallAttemptRow = typeof callAttempts.$inferSelect;
