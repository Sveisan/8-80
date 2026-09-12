import type { ScriptLines } from '../script.ts';
import type { AttemptStatus } from '../schedule/scheduler.ts';
import type { CallOutcome } from '../store/types.ts';
import { extractCommitment } from './commitment.ts';

/** One line of a call, from whichever platform ran it. */
export interface Turn {
  speaker: 'agent' | 'caller';
  text: string;
}

/**
 * What a platform hands back when a call is over.
 *
 * Deliberately the smallest shape every vendor can fill: who said what, how
 * long it lasted, and their own word for how it ended. Anything richer would
 * bind this to one of them, and the transcript is the only artefact all of
 * them produce.
 */
export interface CallTranscript {
  providerCallId: string;
  turns: Turn[];
  durationMs: number;
  /** The platform's own word for it, kept verbatim for their support desk. */
  endedReason?: string;
}

export interface Settlement {
  status: Exclude<AttemptStatus, 'claimed' | 'placed' | 'missed'>;
  outcome?: CallOutcome;
  /** Why, in our words. Never anything the caller said. */
  note?: string;
}

/** Below this, a call with no caller in it is a failure rather than a short call. */
const TOO_SHORT_MS = 90_000;

/**
 * Decide what a finished call actually was, and what to remember from it.
 *
 * The case worth the code is `silent`. A platform reported a call as Succeeded
 * when its own transcript showed the agent speaking from the first second and
 * the caller hearing none of it — no error, no alert, a green tick and a dead
 * phone. Nothing external will tell us that happened, so it is inferred here:
 * the agent spoke, the caller never did, and it ended quickly. That covers two
 * different events — audio that never arrived, and someone who answered and
 * said nothing — and they are deliberately one status, because the response to
 * both is the same. Look at it, and do not pretend a week happened.
 *
 * A call that reached no commitment is not a failure. Plenty of real calls
 * end without one, and treating that as an error would put a red mark against
 * the weeks a person most needed the call to be ordinary.
 */
export function settle(transcript: CallTranscript, script: ScriptLines): Settlement {
  const agentTurns = transcript.turns.filter((t) => t.speaker === 'agent');
  const callerTurns = transcript.turns.filter((t) => t.speaker === 'caller');

  if (agentTurns.length === 0) {
    return { status: 'failed', note: `the agent never spoke (${transcript.endedReason ?? 'no reason given'})` };
  }

  if (callerTurns.length === 0 && transcript.durationMs < TOO_SHORT_MS) {
    return {
      status: 'silent',
      note: `agent spoke ${agentTurns.length}×, caller never did, ${Math.round(transcript.durationMs / 1000)}s`,
    };
  }

  // The commitment comes from the mentor's read-back, not the caller's words —
  // see commitment.ts for why. Joined across turns because the read-back can
  // be split by a backchannel.
  const spoken = agentTurns.map((t) => t.text).join(' ');
  const commitment = extractCommitment(spoken, script);

  const outcome: CallOutcome = {
    at: new Date().toISOString(),
    durationMs: transcript.durationMs,
    ...(commitment ? { commitment: commitment.text, ...(commitment.day ? { day: commitment.day } : {}) } : {}),
  };

  return {
    status: 'completed',
    outcome,
    ...(commitment ? {} : { note: 'no commitment was reached' }),
  };
}
