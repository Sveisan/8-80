import { config } from '../config.ts';
import { log } from '../log.ts';
import { CallNotPlaced } from '../agent/speechify.ts';
import { Links } from '../link/token.ts';
import { textAfterFailedCall, textAfterMissedCall } from '../sms/missed.ts';
import type { LoopDeps } from './deps.ts';

export interface TickResult {
  claimed: number;
  placed: number;
  failed: number;
}

/**
 * One wake-up: ring everybody whose slot has come round.
 *
 * Runs from cron, most often doing nothing — the cost of a tick with nobody due
 * is one indexed query. That is the point of a timer rather than a queue: there
 * is no state to keep warm between Tuesdays, and a box that reboots on Sunday
 * comes back knowing exactly as much as it did before.
 *
 * Every caller is placed in its own try. One person's number being unreachable,
 * or the platform refusing one request, must not cost the other nine their
 * week — which is what a single await in a loop over a shared promise does.
 */
/**
 * How many times a refusal is tried again before the week is given up on.
 *
 * The platform's carrier refuses calls intermittently — four attempts one
 * evening, one connected. Their error names the causes: a trunk's
 * calls-per-second limit, congestion, a destination not enabled. Whatever it
 * is, it is not about this caller and it is not permanent, and the first
 * version of this treated one 403 as final: somebody's weekly call, gone,
 * because a carrier was busy for a second.
 *
 * Short waits, and few of them. The slot has a two-hour grace period, so there
 * is room — but a caller whose phone rings four minutes late has still been
 * rung late, and a queue of retries piling into the next tick is worse than a
 * missed week.
 */
const ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 6_000];

async function withRetries<T>(place: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await place();
    } catch (e) {
      // A phone that rang and was not answered is not a failure to retry, it
      // is the answer. Retrying it rings somebody three times in seventy
      // seconds from an unknown number, which is the opposite of this product
      // — and is what this did until the adapter started saying which of the
      // two had happened.
      if (e instanceof CallNotPlaced && e.rang) throw e;
      if (attempt >= ATTEMPTS) throw e;
      const wait = BACKOFF_MS[attempt - 1] ?? 6_000;
      // The message, not the number: log() scrubs, and which caller it was for
      // is already in the attempt row.
      log('agent.retrying', { attempt, of: ATTEMPTS, inMs: wait, why: (e as Error).message });
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * The one text, for a call that never connected.
 *
 * Mints the link and sends it exactly as `settle` does for a call that rang
 * through and was not answered. Never throws: the attempt is already closed,
 * and a text that will not send must not stop the tick reaching the next
 * caller on a Friday morning.
 */
async function textForMissedCall(
  claim: { attemptId: string; phoneHash: string },
  deps: LoopDeps,
  rang: boolean,
): Promise<void> {
  try {
    const phone = await deps.store.phoneFor(claim.phoneHash);
    if (!phone) return;
    const base = config.link.publicUrl();
    const link = base ? `${base.replace(/\/$/, '')}/r/${await new Links(deps.store.raw).mint(claim.phoneHash)}` : undefined;
    // Two sentences, because they are two different things to the person
    // reading them. "Rang just now" is a lie when their phone never made a
    // sound, and a product whose one promise is that it turns up cannot
    // explain an absence with a fiction.
    const send = rang ? textAfterMissedCall : textAfterFailedCall;
    await send(claim.attemptId, phone, deps, link);
  } catch (e) {
    log('tick.missed_text_failed', { reason: (e as Error).message });
  }
}

export async function tick(deps: LoopDeps, now = new Date()): Promise<TickResult> {
  const claims = await deps.scheduler.claimDue(now);
  const result: TickResult = { claimed: claims.length, placed: 0, failed: 0 };

  for (const claim of claims) {
    try {
      const phone = await deps.store.phoneFor(claim.phoneHash);
      if (!phone) {
        // The claim exists and the caller does not. Not recoverable here.
        await deps.scheduler.finish(claim.attemptId, 'failed', { note: 'no number on file' });
        result.failed++;
        continue;
      }

      const caller = await deps.store.load(phone);
      const placed = await withRetries(() => deps.agent.placeCall({
        to: phone,
        // Which kind of call it is, not which agent serves it: the mapping from
        // one to the other is the platform's business and lives in the adapter.
        firstCall: caller.callNumber <= 1,
        variables: variablesFor(caller),
        ...(config.speechify.callerIdNumber ? { callerIdNumber: config.speechify.callerIdNumber } : {}),
        ...(caller.language ? { language: caller.language } : {}),
        ringingTimeoutMs: config.speechify.ringingTimeoutMs,
        amd: config.speechify.amd,
      }));

      await deps.scheduler.markPlaced(claim.attemptId, placed.conversationId);
      result.placed++;
    } catch (e) {
      if (e instanceof CallNotPlaced && e.rang) {
        // Their phone rang and they did not pick up. That is a missed call and
        // it gets the one text — the same path a call that connects and then
        // goes unanswered takes, so the two cannot drift apart. Before this,
        // an unanswered ring was filed as "could not place" and the person got
        // nothing at all: no call, no text, no way to move it.
        await deps.scheduler.finish(claim.attemptId, 'missed', { note: e.reason || 'no answer' });
        await textForMissedCall(claim, deps, true);
        result.failed++;
        continue;
      }
      // Nobody was rung. That is not a missed call and it does not get the
      // missed-call text — but it does get a text, because from where they are
      // sitting the weekly call simply did not happen, and a silence is how
      // somebody decides a thing is broken and stops expecting it.
      await deps.scheduler.finish(claim.attemptId, 'failed', {
        note: `could not place after ${ATTEMPTS} tries: ${(e as Error).message}`,
      });
      await textForMissedCall(claim, deps, false);
      result.failed++;
    }
  }

  if (claims.length) log('tick.done', { ...result });
  return result;
}

/**
 * Last week, in their own words, as the agent will hear it.
 *
 * This is the whole of what the platform learns about a person, and it is
 * deliberately three fields. Their Memory feature would accumulate the rest;
 * it stays off, and this is what replaces it.
 */
function variablesFor(caller: { name?: string; lastCommitment?: string; lastCommitmentDay?: string; callNumber: number }): Record<string, string> {
  return {
    call_number: String(caller.callNumber),
    caller_name: caller.name ?? '',
    // Always sent, even empty — a platform that substitutes a prompt does it
    // blindly, and a missing variable becomes "Last week you said you'd . What
    // happened?" The marker is a value the prompt has an instruction for; an
    // omission is a hole nothing can act on.
    last_commitment: caller.lastCommitment ?? NOTHING_RECORDED,
    last_day: caller.lastCommitmentDay ?? '',
  };
}

/** What the prompt is told to look for when nothing was written down. */
export const NOTHING_RECORDED = '(nothing recorded)';
