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
    onboarding: text('onboarding').notNull().default('pending'),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    /**
     * Serve the next call the first-call experience, whatever the call number
     * says, then clear itself.
     *
     * A testing affordance that has to live in the product, because the thing
     * it makes testable cannot be reached any other way: whoever built the
     * onboarding call has already been called, so their own number always gets
     * the returning prompt. The alternative was deleting yourself and signing
     * up again for every pass, which costs a verification text, erases the
     * history the returning call is supposed to remember, and is enough friction
     * that the onboarding stops being rehearsed at all.
     *
     * One shot on purpose. A flag that stays set is a caller permanently stuck
     * being introduced to a mentor they have known for a year.
     */
    rehearseFirstCall: boolean('rehearse_first_call').notNull().default(false),
    /** What they said they would do, in their own words. Encrypted. */
    lastCommitmentEnc: text('last_commitment_enc'),
    /** The day they named. A weekday name on its own tells nobody anything. */
    lastCommitmentDay: text('last_commitment_day'),
    consecutiveUndone: integer('consecutive_undone').notNull().default(0),
    /** Weeks the commitment came back done, partly done, or not. Counts only. */
    weeksDone: integer('weeks_done').notNull().default(0),
    weeksPartly: integer('weeks_partly').notNull().default(0),
    weeksUndone: integer('weeks_undone').notNull().default(0),
    patienceOffsetMs: integer('patience_offset_ms'),
    /** Their own eight and eighty, in their words. Encrypted. */
    eightEnc: text('eight_enc'),
    eightyEnc: text('eighty_enc'),
    /** An assumption they named and chose to test, in their words. Encrypted. */
    beliefEnc: text('belief_enc'),
    /** Their goals for this year, in their words. Encrypted. */
    goalsEnc: text('goals_enc'),
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
    /**
     * A flagged call holds every later one until a person has reviewed it.
     * Not `paused`: that is the caller's own decision to stop, and a review
     * being cleared must never be what restarts somebody who said STOP.
     */
    heldForReview: boolean('held_for_review').notNull().default(false),
    smsOptOut: boolean('sms_opt_out').notNull().default(false),

    /*
     * Billing. Four columns, and the product works without any of them set —
     * a caller enrolled from the command line has no trial and no
     * subscription and is rung anyway, which is how the first callers were
     * added and how anybody comped will be added later.
     */
    /** When the free month runs out. Null means it never does. */
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    /** 'trialing' | 'active' | 'past_due' | 'cancelled' | 'comped'. */
    billingStatus: text('billing_status').notNull().default('comped'),
    /**
     * Lemon Squeezy's ids, in the clear, because they are opaque integers that
     * identify a row in somebody else's database rather than a person in ours
     * — and because a webhook arriving with one has to be able to find this
     * row by it, which an encrypted column cannot do.
     */
    lsSubscriptionId: text('ls_subscription_id'),
    lsCustomerId: text('ls_customer_id'),
    billingProvider: text('billing_provider'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    paidUntil: timestamp('paid_until', { withTimezone: true }),
    feedbackOptOut: boolean('feedback_opt_out').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('callers_phone_hash_key').on(t.phoneHash),
    index('callers_last_call_at_idx').on(t.lastCallAt),
    index('callers_due_idx').on(t.nextCallAt),
    uniqueIndex('callers_ls_subscription_key').on(t.lsSubscriptionId),
    index('callers_trial_idx').on(t.trialEndsAt),
  ],
);

/**
 * Somebody who has filled in the form and not yet proved they own the number.
 *
 * A separate table, and this is the whole security argument for the sign-up
 * page: a public form that writes to `callers` is a public form that places
 * weekly phone calls to any number typed into it. That is not a sign-up, it is
 * a harassment tool with a scheduler. Nothing reaches `callers` until a code
 * sent to the number comes back.
 *
 * The number and address are encrypted here exactly as they are there — a row
 * that has not been verified is still somebody's phone number, and the table
 * that holds the unverified ones is the one nobody thinks to protect.
 *
 * Rows are short-lived and pruned. An abandoned sign-up is a person who
 * changed their mind, and keeping their number for a week because they typed
 * it once is the behaviour this product exists to be the opposite of.
 */
export const signups = pgTable(
  'signups',
  {
    id: text('id').primaryKey(),
    /** Deterministic, so a second attempt from the same number replaces the first. */
    phoneHash: text('phone_hash').notNull(),
    phoneEnc: text('phone_enc').notNull(),
    emailEnc: text('email_enc'),
    name: text('name'),
    timezone: text('timezone').notNull(),
    slotWeekday: integer('slot_weekday').notNull(),
    slotMinute: integer('slot_minute').notNull(),
    /**
     * SHA-256 of the six digits. Never the digits: this table is readable by
     * anything that can read the others, and a plaintext code turns one
     * over-broad query into the ability to verify any pending number.
     */
    codeHash: text('code_hash').notNull(),
    /** Five wrong guesses and the code is dead. A six-digit code is 1e6 wide. */
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('signups_phone_key').on(t.phoneHash), index('signups_expiry_idx').on(t.expiresAt)],
);

export type SignupRow = typeof signups.$inferSelect;

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
    /**
     * When the one missed-call text went out. Its purpose is to be null exactly
     * once: SCRIPT.md §13 allows a single text per missed call, and a retry, a
     * redeploy or a second worker must not turn that into two.
     */
    smsSentAt: timestamp('sms_sent_at', { withTimezone: true }),
    /**
     * 1 or 2 when the safety pipeline flags this call (call/safety.ts), null
     * otherwise. DECISIONS.md: a flagged call is never auto-actioned —
     * everything that acts after a call reads it and holds back.
     */
    safetyTier: integer('safety_tier'),
    /** When a person reviewed the flagged call. Null means it is still waiting. */
    safetyReviewedAt: timestamp('safety_reviewed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('call_attempts_slot_key').on(t.phoneHash, t.scheduledFor),
    index('call_attempts_status_idx').on(t.status, t.claimedAt),
  ],
);

/**
 * The one request for feedback each caller ever gets, and their answers.
 *
 * One row per caller, keyed on the hash, so "once, ever" is a primary key and
 * not a flag somebody can forget to check. The row is written before the text
 * is sent: a retry, a redeploy or a second worker finds it and sends nothing.
 *
 * `state` is 'sent', 'failed' (the text did not leave), or 'skipped' (the call
 * it would have followed was flagged — permanent, never deferred).
 *
 * The answers are what somebody said about this product and sometimes about
 * themselves, so they are held like a transcript: encrypted in the
 * application before they reach Postgres, never logged, in the export and gone
 * with "delete everything". Kept until then, by the owner's decision on
 * 2026-09-30 — feedback that deletes itself in a fortnight is feedback nobody
 * got to read.
 */
export const feedback = pgTable('feedback', {
  phoneHash: text('phone_hash').primaryKey(),
  state: text('state').notNull(),
  /** The call it followed. */
  attemptId: text('attempt_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  /** First time the link was opened. Counted, never the content. */
  openedAt: timestamp('opened_at', { withTimezone: true }),
  /** First time the form was sent; `updatedAt` for every edit after. */
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  pickupEnc: text('pickup_enc'),
  nearlyEnc: text('nearly_enc'),
  elseEnc: text('else_enc'),
});

/** Encrypted durable send intents. Acceptance and delivery are different states. */
export const messageOutbox = pgTable('message_outbox', {
  id: text('id').primaryKey(), eventKey: text('event_key').notNull().unique(),
  phoneHash: text('phone_hash').notNull(), channel: text('channel').notNull(), kind: text('kind').notNull(),
  reference: text('reference'), recipientEnc: text('recipient_enc'), payloadEnc: text('payload_enc'),
  status: text('status').notNull().default('pending'), reason: text('reason'),
  attempts: integer('attempts').notNull().default(0), providerId: text('provider_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  firstAttemptAt: timestamp('first_attempt_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }), acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }), checkedAt: timestamp('checked_at', { withTimezone: true }),
}, t => [index('message_outbox_due_idx').on(t.status, t.availableAt), index('message_outbox_caller_idx').on(t.phoneHash, t.createdAt)]);

export const messageAttempts = pgTable('message_attempts', {
  id: text('id').primaryKey(), messageId: text('message_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }), result: text('result'),
}, t => [index('message_attempts_message_idx').on(t.messageId)]);

export type CallerRow = typeof callers.$inferSelect;
export type CallAttemptRow = typeof callAttempts.$inferSelect;

/**
 * Short codes for the reschedule page.
 *
 * A signed stateless token carries its own claims and needs no table — and is
 * eighty characters of base64 in a text message, which looks like exactly the
 * kind of link nobody should tap. A row is shorter and better: ten characters,
 * and because it exists somewhere it can also be revoked, which a signed token
 * cannot be without rotating the secret for everyone.
 *
 * The code is random, not derived. A code derived from the caller would let
 * anybody holding one work out the others.
 */
export const links = pgTable(
  'links',
  {
    /** Ten characters of unambiguous base32 — no 0/O, no 1/l. */
    code: text('code').primaryKey(),
    phoneHash: text('phone_hash').notNull(),
    /** Exactly one thing this code may do. */
    purpose: text('purpose').notNull().default('reschedule'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [index('links_expiry_idx').on(t.expiresAt)],
);

export type LinkRow = typeof links.$inferSelect;

/**
 * Every webhook delivery we accepted the signature of, kept briefly.
 *
 * This exists because of one evening: three real conversations arrived,
 * verified, and were discarded on a line of code, and finding out why cost five
 * phone calls at midnight — book a call, answer it, say something, hang up,
 * wait, read a log. A stored delivery turns that loop into `npm run deliveries
 * -- --replay <id>`, which runs the same code against the same bytes in a
 * second.
 *
 * It is written BEFORE the payload is parsed, which is the entire point: the
 * deliveries worth having are the ones we could not read.
 *
 * The body is a transcript, so two things are true of this table that are not
 * true of the others. It is encrypted like everything a caller said. And it is
 * pruned on a timer — `CallerRecord` says this is an accountability call and
 * not a file on someone, and a debugging buffer that is never emptied becomes
 * the file it promised not to be. The default is fourteen days, long enough to
 * debug last week's call and not long enough to be a record.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    /** Their `Speechify-Delivery-Id`, so a retry overwrites rather than piles up. */
    id: text('id').primaryKey(),
    /** From the header, before anything is parsed. Null when they sent none. */
    event: text('event'),
    /** Best effort, for looking one up by the call it belongs to. */
    conversationId: text('conversation_id'),
    /** The raw body, verbatim and encrypted. Verbatim matters: a re-serialised
     * payload is a different payload, and the bug may be in the difference. */
    bodyEnc: text('body_enc').notNull(),
    /** What we made of it: 'settled', 'unreadable: …', 'ignored', and so on. */
    verdict: text('verdict'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_deliveries_received_idx').on(t.receivedAt),
    index('webhook_deliveries_conversation_idx').on(t.conversationId),
  ],
);

export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;

/**
 * When each background job last ran. One row per job, overwritten.
 *
 * Because "the scheduler is running and nothing was due" and "the scheduler
 * stopped three hours ago" produced identical evidence: the tick logs only when
 * it claims a call, so a quiet minute and a dead timer look the same in the
 * journal. That ambiguity cost an evening of guessing, twice.
 *
 * A row rather than a log line, so the question "is it alive" has an answer
 * that can be read at any time rather than inferred from an absence.
 */
export const heartbeats = pgTable('heartbeats', {
  /** 'tick', and whatever else grows its own schedule. */
  job: text('job').primaryKey(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  /** What it did, for the run that did something. Never anything a caller said. */
  note: text('note'),
});

export type HeartbeatRow = typeof heartbeats.$inferSelect;

/** Short-lived phone recovery proof, separate from pending enrolment. */
export const accessCodes = pgTable('access_codes', {
  phoneHash: text('phone_hash').primaryKey(),
  id: text('id').notNull().unique(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumed: boolean('consumed').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  windowAt: timestamp('window_at', { withTimezone: true }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  sends: integer('sends').notNull(),
}, (t) => [index('access_codes_sent_idx').on(t.sentAt)]);

/** Daily request counts with no visitor identifiers, cookies, IPs or form values. */
export const journeyCounts = pgTable('journey_counts', {
  day: text('day').notNull(),
  event: text('event').notNull(),
  count: integer('count').notNull().default(0),
}, t => [uniqueIndex('journey_counts_day_event_idx').on(t.day, t.event)]);

/** Named milestones only; no free text, recording or remembered content. */
export const journeyEvents = pgTable('journey_events', {
  id: text('id').primaryKey(),
  phoneHash: text('phone_hash').notNull(),
  event: text('event').notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('journey_events_phone_at_idx').on(t.phoneHash, t.at), index('journey_events_at_idx').on(t.at)]);
