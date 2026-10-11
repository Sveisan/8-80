import { milestone } from '../journey/measure.ts';
import { settleBeliefs } from '../beliefs/runtime.ts';
import { accountState } from '../link/account.ts';
import { log } from '../log.ts';
import { settle } from '../call/outcome.ts';
import { composeRecap } from '../recap/compose.ts';
import { textAfterCall, textAfterMissedCall } from '../sms/missed.ts';
import { Links } from '../link/token.ts';
import { config } from '../config.ts';
import { eventOf, toTranscript } from '../webhook/speechify.ts';
import { resolveSpokenTime } from '../call/reschedule.ts';
import { describeAppointment, letterDate } from '../schedule/time.ts';
import type { LoopDeps } from './deps.ts';
import { queued, dispatchMessage, enqueue } from '../messages/outbox.ts';
import { Scheduler, flagForReview } from '../schedule/scheduler.ts';
import { safetyTier, alertText } from '../call/safety.ts';

export interface Settled {
  handled: boolean;
  status?: string;
  /** Why nothing happened, when nothing happened. */
  why?: string;
}

/** Their words for a call that rang out or reached a machine. */
/**
 * A fresh link into the reschedule page, or nothing when there is no public URL
 * to point at. Shared by the missed-call text and the after-call one so the two
 * cannot come to disagree about what a link looks like.
 */
async function linkFor(deps: LoopDeps, phoneHash: string): Promise<string | undefined> {
  const base = config.link.publicUrl();
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/r/${await new Links(deps.store.raw).mint(phoneHash)}`;
}

const NOT_ANSWERED = /no[_ -]?answer|unanswered|voicemail|machine|busy|rejected|declined/i;

/**
 * A finished call, from webhook to recap.
 *
 * The order is deliberate and the first step is the important one. Webhooks are
 * retried, and settling twice would increment the call number twice, overwrite
 * the commitment with itself and send the recap a second time — three things a
 * caller would notice. Claim, state changes and message intents commit together.
 * Provider I/O follows the commit; the outbox owns retries and uncertain results.
 *
 * The recap goes only to a call that actually happened. A call nobody could
 * hear produces no email: writing to somebody about a conversation they did not
 * have is worse than saying nothing.
 */
export async function settleConversation(
  payload: unknown, deps: LoopDeps, headerEvent?: string, now = new Date(),
): Promise<Settled> {
  const module = await settleBeliefs(payload, deps, headerEvent, now);
  if (module) return module;
  const transcript = toTranscript(payload);
  const attempt = await deps.scheduler.attemptForConversation(transcript.providerCallId);
  if (!attempt) return { handled: false, why: 'no attempt for this conversation' };
  const ids: string[] = [];
  const result = await deps.store.raw.begin(async tx => {
    const [caller] = await tx`select phone_hash from callers where phone_hash = ${attempt.phoneHash} for update`;
    if (!caller) return { handled: false, why: 'account deleted' };
    const messages = queued(tx, attempt.phoneHash, `call:${attempt.id}`, now, 'call', attempt.id);
    const answer = await settleInside(payload, { ...deps, store: deps.store.in(tx), scheduler: new Scheduler(tx), sms: messages.sms, mailer: messages.mailer }, headerEvent, now);
    ids.push(...messages.ids);
    // Silent/interrupted calls get a way back, with no invented next-week promise.
    if (answer.handled && ['silent', 'unverified', 'interrupted'].includes(answer.status ?? '') && !messages.ids.length) {
      const base = config.link.publicUrl().replace(/\/$/, '');
      const phone = await deps.store.in(tx).phoneFor(attempt.phoneHash);
      if (base && phone) ids.push(await enqueue(tx, { eventKey: `call:${attempt.id}:sms`, phoneHash: attempt.phoneHash, channel: 'sms', kind: 'call', reference: attempt.id,
        to: phone, body: (deps.script.get('sms.interrupted') ?? '').replace('{{link}}', `${base}/me`) }, now));
    }
    return answer;
  });
  for (const id of ids) await dispatchMessage(deps, id, now);
  // After the commit, so a rolled-back settle cannot send a false alarm.
  await alertIfUrgent(deps, attempt.id);
  return result;
}

async function settleInside(
  payload: unknown,
  deps: LoopDeps,
  headerEvent?: string,
  now = new Date(),
): Promise<Settled> {
  const event = eventOf(payload, headerEvent);
  if (!event) {
    // Logged, because this is the branch that threw away three real calls in
    // silence. An event we do not act on is ordinary; an event we cannot NAME
    // is a payload we have misunderstood, and the two must not look alike.
    log('webhook.ignored', { header: headerEvent ?? null });
    return { handled: false, why: 'not an event we act on' };
  }

  const transcript = toTranscript(payload);
  const attempt = await deps.scheduler.attemptForConversation(transcript.providerCallId);
  if (!attempt) {
    // A call we did not place — the console's Try it button, or somebody
    // else's. Acknowledged and ignored rather than guessed at.
    return { handled: false, why: 'no attempt for this conversation' };
  }

  if (!(await deps.scheduler.claimSettlement(attempt.id))) {
    return { handled: false, why: `already settled (${attempt.status})` };
  }

  const phone = await deps.store.phoneFor(attempt.phoneHash);
  if (!phone) {
    await deps.scheduler.finish(attempt.id, 'failed', { note: 'no number on file' });
    return { handled: true, status: 'failed', why: 'no number on file' };
  }

  const outcome = settle(transcript, deps.script, now);
  // Before anything else acts on the call. The flag is what every later step
  // — the recap, the texts, the next call — reads and holds back for.
  const finding = safetyTier(transcript.turns, deps.script);
  if (finding) {
    await flagForReview(deps.store.raw, attempt.id, finding.tier);
    log('safety.finding', { tier: finding.tier, reasons: finding.reasons });
  }
  // Fetched once: the recap promises when the next call is, and a reschedule
  // needs the same zone to resolve a spoken time into an instant.
  const slot = await deps.scheduler.slotFor(phone);

  // Resolve and persist a callback before any message describes the next call.
  let callbackBooked = false;
  if (outcome.callAgain && slot) {
    const at = resolveSpokenTime(outcome.callAgain, slot.timezone, now);
    callbackBooked = await deps.scheduler.moveIfActive(phone, at, undefined, attempt.cycleKey);
    log('settle.call_again', { booked: callbackBooked, at: at.toISOString() });
  }
  const next = await deps.scheduler.nextEligibleCallFor(phone, now);
  const nextSaid = next && slot ? describeAppointment(next, slot.timezone, (await deps.store.load(phone)).language) : undefined;

  if (outcome.callAgain) {
    await textAfterCall(attempt.id, phone, callbackBooked && nextSaid ? 'callback' : 'callback_unavailable', deps,
      await linkFor(deps, attempt.phoneHash), nextSaid);
  }

  if (outcome.status === 'completed' && outcome.outcome) {
    await deps.store.record(phone, outcome.outcome);
    if (outcome.outcome.onboardingComplete) await milestone(deps.store.raw, attempt.phoneHash, 'onboarding_complete', attempt.phoneHash, now);
    if (outcome.outcome.commitment) await milestone(deps.store.raw, attempt.phoneHash, 'action_read_back', attempt.id, now);
    const caller = await deps.store.load(phone);
    // The existing transcript classifier verifies caller participation. This
    // operational signal includes no-action calls; it does not claim usefulness.
    if (['complete', 'legacy'].includes(caller.onboarding ?? '')) {
      await milestone(deps.store.raw, attempt.phoneHash, 'conversation_completed', attempt.id, now, attempt.cycleKey);
    }
    const publicUrl = config.link.publicUrl().replace(/\/$/, '');
    const account = await accountState(deps.store.raw, attempt.phoneHash, now);
    const recap = composeRecap(outcome.outcome, deps.script, {
      ...(account?.billing === 'trialing' && account.trialEnds && slot ? { trialEnds: describeAppointment(account.trialEnds, slot.timezone, caller.language) } : {}),
      ...(publicUrl ? { controlUrl: `${publicUrl}/me` } : {}),
      // The next CALL, not the day the commitment lands on. Those are different
      // days, and this line is the one the caller would act on.
      ...(nextSaid ? { nextSlot: nextSaid } : {}),
      // The letterhead's date. In the caller's zone, because a call taken at
      // half past eight in Oslo is the previous day in UTC often enough to
      // matter, and a letter dated the day before the call reads as a mistake.
      ...dated(slot ? letterDate(outcome.outcome.at, slot.timezone, caller.language) : undefined),
    });
    if (caller.email) await deps.mailer.send(caller.email, recap);

    // What the call could not do itself. The mentor says out loud that it
    // cannot move the slot, and it never asks for an address — both true, and
    // both an apology until something follows them. One text, one link, and
    // the slot wins the tie because it is the thing they asked for. See
    // sms/missed.ts.
    const want = outcome.wantsSlotChange ? 'slot' : caller.email ? undefined : 'email';
    if (want && !outcome.callAgain) {
      await textAfterCall(attempt.id, phone, want, deps, await linkFor(deps, attempt.phoneHash));
    }
  }

  await deps.scheduler.finish(attempt.id, outcome.status, {
    durationMs: transcript.durationMs,
    ...(outcome.note ? { note: outcome.note } : {}),
  });

  // Nobody picked up. This is the one text — ARCHITECTURE.md: never voicemail,
  // one warm SMS — and `textAfterMissedCall` guarantees the "one".
  if (outcome.status === 'failed' && NOT_ANSWERED.test(transcript.endedReason ?? '')) {
    await textAfterMissedCall(attempt.id, phone, deps, await linkFor(deps, attempt.phoneHash));
  }

  log('settle.done', { status: outcome.status, event });
  return { handled: true, status: outcome.status };
}

/** exactOptionalPropertyTypes: an absent date is an absent key, not `undefined`. */
const dated = (date: string | undefined): { date?: string } => (date ? { date } : {});

/**
 * Tier 1 reaches the operator the same evening, as a text with nothing from
 * the call in it. Tier 2 waits for the daily digest (loop/digest.ts). A text
 * that fails is logged as an error and does not fail the settle: the flag and
 * the hold are already written, and those are what protect the caller.
 */
async function alertIfUrgent(deps: LoopDeps, attemptId: string): Promise<void> {
  const [row] = await deps.store.raw<{ safety_tier: number | null; note: string | null }[]>`
    select safety_tier, note from call_attempts where id = ${attemptId}
  `;
  if (row?.safety_tier !== 1) return;
  const to = config.operator.phones();
  if (!to.length) {
    log('safety.unalerted', { attemptId, why: 'OPERATOR_PHONE is not set; a tier-1 call is waiting with nobody told' });
    return;
  }
  // Each separately: one number failing must not stop the other being told.
  for (const phone of to) {
    try {
      await deps.sms.send(phone, alertText(1));
      log('safety.alerted', { attemptId, tier: 1 });
    } catch (e) {
      log('safety.unalerted', { attemptId, why: (e as Error).message });
    }
  }
}
