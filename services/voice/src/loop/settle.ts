import { log } from '../log.ts';
import { settle } from '../call/outcome.ts';
import { composeRecap } from '../recap/compose.ts';
import { textAfterMissedCall } from '../sms/missed.ts';
import { Links } from '../link/token.ts';
import { config } from '../config.ts';
import { eventOf, toTranscript } from '../webhook/speechify.ts';
import { resolveSpokenTime } from '../call/reschedule.ts';
import { describeSlot, letterDate } from '../schedule/time.ts';
import type { LoopDeps } from './deps.ts';

export interface Settled {
  handled: boolean;
  status?: string;
  /** Why nothing happened, when nothing happened. */
  why?: string;
}

/** Their words for a call that rang out or reached a machine. */
const NOT_ANSWERED = /no[_ -]?answer|unanswered|voicemail|machine|busy|rejected|declined/i;

/**
 * A finished call, from webhook to recap.
 *
 * The order is deliberate and the first step is the important one. Webhooks are
 * retried, and settling twice would increment the call number twice, overwrite
 * the commitment with itself and send the recap a second time — three things a
 * caller would notice. So permission is taken first, atomically, and everything
 * after it happens exactly once.
 *
 * The recap goes only to a call that actually happened. A call nobody could
 * hear produces no email: writing to somebody about a conversation they did not
 * have is worse than saying nothing.
 */
export async function settleConversation(
  payload: unknown,
  deps: LoopDeps,
  headerEvent?: string,
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

  const outcome = settle(transcript, deps.script);
  // Fetched once: the recap promises when the next call is, and a reschedule
  // needs the same zone to resolve a spoken time into an instant.
  const slot = await deps.scheduler.slotFor(phone);

  if (outcome.status === 'completed' && outcome.outcome) {
    await deps.store.record(phone, outcome.outcome);
    const caller = await deps.store.load(phone);
    const recap = composeRecap(outcome.outcome, deps.script, {
      // The next CALL, not the day the commitment lands on. Those are different
      // days, and this line is the one the caller would act on.
      ...(slot ? { nextSlot: describeSlot(slot, caller.language) } : {}),
      // The letterhead's date. In the caller's zone, because a call taken at
      // half past eight in Oslo is the previous day in UTC often enough to
      // matter, and a letter dated the day before the call reads as a mistake.
      ...dated(slot ? letterDate(outcome.outcome.at, slot.timezone, caller.language) : undefined),
    });
    if (caller.email) {
      try {
        await deps.mailer.send(caller.email, recap);
      } catch (e) {
        // The commitment is already stored, which is the part that matters.
        // A failed send is logged and not retried: three recaps is worse than
        // none, and next week's call does not depend on this email.
        log('recap.not_sent', { reason: (e as Error).message });
      }
    }
  }

  await deps.scheduler.finish(attempt.id, outcome.status, {
    durationMs: transcript.durationMs,
    ...(outcome.note ? { note: outcome.note } : {}),
  });

  // The mentor said it would ring back, so the system rings back. Until this
  // existed the agreement was a sentence and nothing else: a caller was told
  // "I'll ring you at half five", believed it, and the scheduler knew nothing
  // about it. A promise the product cannot keep is worse than a refusal.
  if (outcome.callAgain) {
    if (slot) {
      const at = resolveSpokenTime(outcome.callAgain, slot.timezone, new Date());
      await deps.scheduler.callAgainAt(phone, at);
      log('settle.call_again', { at: at.toISOString() });
    } else {
      // No zone means no instant we could defend, and a callback at the wrong
      // hour is worse than none. The weekly slot stands.
      log('settle.call_again_unresolved', { why: 'no slot, so no timezone' });
    }
  }

  // Nobody picked up. This is the one text — ARCHITECTURE.md: never voicemail,
  // one warm SMS — and `textAfterMissedCall` guarantees the "one".
  if (outcome.status === 'failed' && NOT_ANSWERED.test(transcript.endedReason ?? '')) {
    const base = config.link.publicUrl();
    const link = base
      ? `${base.replace(/\/$/, '')}/r/${await new Links(deps.store.raw).mint(attempt.phoneHash)}`
      : undefined;
    await textAfterMissedCall(attempt.id, phone, deps, link);
  }

  log('settle.done', { status: outcome.status, event });
  return { handled: true, status: outcome.status };
}

/** exactOptionalPropertyTypes: an absent date is an absent key, not `undefined`. */
const dated = (date: string | undefined): { date?: string } => (date ? { date } : {});
