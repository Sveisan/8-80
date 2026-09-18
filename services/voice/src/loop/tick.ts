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
      const placed = await deps.agent.placeCall({
        to: phone,
        // Which kind of call it is, not which agent serves it: the mapping from
        // one to the other is the platform's business and lives in the adapter.
        firstCall: caller.callNumber <= 1,
        variables: variablesFor(caller),
        ...(config.speechify.callerIdNumber ? { callerIdNumber: config.speechify.callerIdNumber } : {}),
        ...(caller.language ? { language: caller.language } : {}),
        ringingTimeoutMs: config.speechify.ringingTimeoutMs,
        amd: config.speechify.amd,
      });

      await deps.scheduler.markPlaced(claim.attemptId, placed.conversationId);
      result.placed++;
    } catch (e) {
      // A refusal here means nobody was rung, which is not a missed call: no
      // text goes out, because there is nothing for them to have missed.
      await deps.scheduler.finish(claim.attemptId, 'failed', { note: `could not place: ${(e as Error).message}` });
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
