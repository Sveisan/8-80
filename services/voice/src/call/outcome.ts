import type { ScriptLines } from '../script.ts';
import type { AttemptStatus } from '../schedule/scheduler.ts';
import type { CallOutcome } from '../store/types.ts';
import { extractCommitment } from './commitment.ts';
import { extractReschedule, type SpokenTime } from './reschedule.ts';
import { readBack } from './readback.ts';
import { lastWeek } from './lastweek.ts';
import { carries } from './scorecard.ts';

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
  status: Exclude<AttemptStatus, 'claimed' | 'placed' | 'settling' | 'missed'>;
  outcome?: CallOutcome;
  /** Why, in our words. Never anything the caller said. */
  note?: string;
  /**
   * They asked to move the weekly call, and the mentor had to say it cannot be
   * done from a call. `setup.change_slot` is that sentence, so its presence is
   * the request — read from the mentor's own branch, like the week's verdict,
   * because the alternative is guessing at "can we do Thursdays instead" in
   * free speech.
   *
   * The other half of the sentence is a text with a link, sent by the settle
   * path. Without it the mentor apologises and nothing follows, which is the
   * shape of a promise this product cannot keep.
   */
  wantsSlotChange?: boolean;
  /**
   * A time the mentor agreed to ring back at, as spoken. Left unresolved here:
   * turning "17:30 today" into an instant needs the caller's zone and the
   * moment the call ended, and this function has neither.
   */
  callAgain?: SpokenTime;
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
export function settle(transcript: CallTranscript, script: ScriptLines, now = new Date()): Settlement {
  const agentTurns = transcript.turns.filter((t) => t.speaker === 'agent' && t.text.trim());
  const callerTurns = transcript.turns.filter((t) => t.speaker === 'caller' && t.text.trim());

  if (agentTurns.length === 0) {
    return { status: 'failed', note: `the agent never spoke (${transcript.endedReason ?? 'no reason given'})` };
  }

  if (callerTurns.length === 0 && transcript.durationMs < TOO_SHORT_MS) {
    return {
      status: 'silent',
      note: `agent spoke ${agentTurns.length}×, caller never did, ${Math.round(transcript.durationMs / 1000)}s`,
    };
  }
  if (callerTurns.length === 0) return { status: 'unverified', note: 'no caller transcript; conversation could not be verified' };

  // The commitment comes from the mentor's read-back, not the caller's words —
  // see commitment.ts for why. Joined across turns because the read-back can
  // be split by a backchannel.
  const spoken = agentTurns.map((t) => t.text).join(' ');
  // The turn that carries the whole read-back first; the whole call only when
  // a backchannel split it.
  const tail = script.get('next.confirm')?.split('}}').at(-1);
  const current = tail && carries(spoken, tail)
    ? agentTurns.map(t => extractCommitment(t.text, script)).filter(c => c !== undefined).pop() ?? extractCommitment(spoken, script)
    : undefined;
  // Older recordings used a question at the end of the fixed read-back.
  const legacyScript = new Map(script).set('next.confirm', 'Right. {{commitment}}, {{day}}. Will you?');
  const legacy = agentTurns.filter(t => /^right[\s.—-]/i.test(t.text.trim()) && /will you\??[.!]?$/i.test(t.text.trim()))
    .map(t => extractCommitment(t.text, legacyScript)).filter(c => c !== undefined).pop();
  const commitment = current ?? legacy;
  const callAgain = extractReschedule(spoken, script);
  const said = agentTurns.map((t) => t.text);
  const selves = readBack(said, script.get('read.first.keep'));

  // A call moved before it got anywhere is not a failed call and not a week
  // that happened. It is an appointment, and the only thing to carry out of it
  // is the time. Recording it as completed would make next week's call open by
  // asking what happened to a commitment nobody ever made.
  if (callAgain && !commitment && !selves && transcript.durationMs < TOO_SHORT_MS) {
    return {
      status: 'rescheduled',
      callAgain,
      note: 'moved during the call',
    };
  }

  // Their own eight and eighty, and an assumption they chose to test — each
  // taken from the line where the mentor read it back, like the commitment.
  if (!commitment && !selves && transcript.durationMs < TOO_SHORT_MS) {
    return { status: 'interrupted', note: 'conversation ended before a substantive exchange' };
  }
  // A correction says back only the part that changed. If this year's goals
  // were corrected after the map, the correction is what was agreed.
  const keptAt = lastIndex(said, script.get('read.first.keep'));
  const fixAt = lastIndex(said, script.get('read.first.fix'));
  if (selves && fixAt > keptAt) {
    const fixed = readBack([said[fixAt] ?? ''], script.get('read.first.fix'))?.['goals'];
    if (fixed) selves['goals'] = fixed;
  }
  const belief = readBack(said, script.get('belief.name'))?.['belief'];
  const week = lastWeek(said, script);
  const changeSlot = script.get('setup.change_slot');
  const wantsSlotChange = !!changeSlot && said.some((t) => carries(t, changeSlot));
  const confirmed = script.get('onboarding.confirmed');
  const mappedAt = transcript.turns.findLastIndex(t => t.speaker === 'agent' && !!readBack([t.text], script.get('read.first.keep')));
  const confirmedAt = transcript.turns.findLastIndex(t => t.speaker === 'agent' && !!confirmed && carries(t.text, confirmed));
  const onboardingComplete = !!selves && mappedAt >= 0 && confirmedAt > mappedAt
    && transcript.turns.slice(mappedAt + 1, confirmedAt).some(t => t.speaker === 'caller' && t.text.trim());

  const outcome: CallOutcome = {
    at: now.toISOString(),
    durationMs: transcript.durationMs,
    ...(onboardingComplete ? { onboardingComplete: true } : {}),
    ...(commitment ? { commitment: commitment.text, ...(commitment.day ? { day: commitment.day } : {}) } : {}),
    ...(selves?.['eight'] ? { eight: selves['eight'] } : {}),
    ...(selves?.['eighty'] ? { eighty: selves['eighty'] } : {}),
    ...(selves?.['goals'] ? { goals: selves['goals'] } : {}),
    ...(belief ? { belief } : {}),
    ...(week ? { lastWeek: week } : {}),
  };

  return {
    status: 'completed',
    outcome,
    ...(wantsSlotChange ? { wantsSlotChange } : {}),
    ...(callAgain ? { callAgain } : {}),
    ...(commitment ? {} : { note: 'no commitment was reached' }),
  };
}

/** The last turn that carries a whole read-back of `template`, or -1. */
function lastIndex(turns: readonly string[], template: string | undefined): number {
  for (let i = turns.length - 1; i >= 0; i--) if (readBack([turns[i] ?? ''], template)) return i;
  return -1;
}
