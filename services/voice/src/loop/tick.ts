import { config } from '../config.ts';
import { log } from '../log.ts';
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
      if (attempt >= ATTEMPTS) throw e;
      const wait = BACKOFF_MS[attempt - 1] ?? 6_000;
      // The message, not the number: log() scrubs, and which caller it was for
      // is already in the attempt row.
      log('agent.retrying', { attempt, of: ATTEMPTS, inMs: wait, why: (e as Error).message });
      await new Promise((r) => setTimeout(r, wait));
    }
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
      // A refusal here means nobody was rung, which is not a missed call: no
      // text goes out, because there is nothing for them to have missed.
      await deps.scheduler.finish(claim.attemptId, 'failed', {
        note: `could not place after ${ATTEMPTS} tries: ${(e as Error).message}`,
      });
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
