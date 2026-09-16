import { log } from '../log.ts';
import { settle } from '../call/outcome.ts';
import { composeRecap } from '../recap/compose.ts';
import { textAfterMissedCall } from '../sms/missed.ts';
import { Links } from '../link/token.ts';
import { config } from '../config.ts';
import { eventOf, toTranscript } from '../webhook/speechify.ts';
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
export async function settleConversation(payload: unknown, deps: LoopDeps): Promise<Settled> {
  const event = eventOf(payload);
  if (!event) return { handled: false, why: 'not an event we act on' };

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

  if (outcome.status === 'completed' && outcome.outcome) {
    await deps.store.record(phone, outcome.outcome);
    const caller = await deps.store.load(phone);
    const recap = composeRecap(outcome.outcome, deps.script, {
      ...(caller.lastCommitmentDay ? { nextSlot: `on ${caller.lastCommitmentDay}` } : {}),
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
