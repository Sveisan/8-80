import type { ScriptLines } from '../script.ts';
import type { AttemptStatus } from '../schedule/scheduler.ts';
import type { CallOutcome } from '../store/types.ts';
import { extractCommitment } from './commitment.ts';
import { extractReschedule, type SpokenTime } from './reschedule.ts';
import { readBack, readBackSpan } from './readback.ts';
import { lastWeek } from './lastweek.ts';
import { carries } from './scorecard.ts';
import { normalise } from '../turn/endpointer.ts';

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
  const said = agentTurns.map((t) => t.text);
  const spoken = said.join(' ');
  const positions = transcript.turns.flatMap((t, i) => t.speaker === 'agent' && t.text.trim() ? [i] : []);
  // The turn that carries the whole read-back first; the whole call only when
  // a backchannel split it.
  const currentSpan = readBackSpan(said, script.get('next.confirm'), { strict: true });
  const current = currentSpan
    ? extractCommitment(said.slice(currentSpan.start, currentSpan.end + 1).join(' '), script, { strict: true })
    : undefined;
  // Older recordings used a question at the end of the fixed read-back.
  const legacyScript = new Map(script).set('next.confirm', 'Right. {{commitment}}, {{day}}. Will you?');
  const legacyIndex = said.findLastIndex(text => /^right[\s.—-]/i.test(text.trim()) && /will you\??[.!]?$/i.test(text.trim()) && !!extractCommitment(text, legacyScript));
  const legacy = legacyIndex >= 0 ? extractCommitment(said[legacyIndex]!, legacyScript) : undefined;
  const currentAt = currentSpan && current ? positions[currentSpan.end] ?? -1 : -1;
  const legacyAt = legacy ? positions[legacyIndex] ?? -1 : -1;
  const committedAt = Math.max(currentAt, legacyAt);
  let commitment = currentAt >= legacyAt ? current : legacy;
  const callAgain = extractReschedule(spoken, script);
  // This fixed branch is used only after an explicit choice of no action.
  // A later read-back can replace it, but an earlier proposal cannot survive it.
  const declinedAt = transcript.turns.findLastIndex(t => t.speaker === 'agent' && !!script.get('next.none') && carries(t.text, script.get('next.none')!)
    || t.speaker === 'caller' && explicitNoAction(t.text));
  const noAction = declinedAt >= 0 && declinedAt > committedAt
    && (transcript.turns[declinedAt]?.speaker === 'caller' || transcript.turns.slice(0, declinedAt).some(t => t.speaker === 'caller' && t.text.trim()));
  const reply: Turn[] = [];
  for (const turn of transcript.turns.slice(committedAt + 1)) {
    if (!turn.text.trim()) continue;
    if (turn.speaker === 'agent') break;
    reply.push(turn);
  }
  // A direct rejection cannot be turned into an agreement just because the
  // mentor forgot the fixed no-action line. Do not infer a replacement action.
  const rejected = /^(no\b(?! problem\b| worries\b)|nope\b|not (that|this week)\b|i (refuse|decline)\b|i (dont|do not) want (that|to)\b|nei\b|jeg vil ikke\b)/.test(normalise(reply.map(t => t.text).join(' ')));
  if (noAction || rejected) commitment = undefined;
  const map = readBackSpan(said, script.get('read.first.keep'));
  const selves = map?.values;

  // A call moved before it got anywhere is not a failed call and not a week
  // that happened. It is an appointment, and the only thing to carry out of it
  // is the time. Recording it as completed would make next week's call open by
  // asking what happened to a commitment nobody ever made.
  if (callAgain && !commitment && !selves && !noAction && transcript.durationMs < TOO_SHORT_MS) {
    return {
      status: 'rescheduled',
      callAgain,
      note: 'moved during the call',
    };
  }

  // Their own eight and eighty, and an assumption they chose to test — each
  // taken from the line where the mentor read it back, like the commitment.
  if (!commitment && !selves && !noAction && transcript.durationMs < TOO_SHORT_MS) {
    return { status: 'interrupted', note: 'conversation ended before a substantive exchange' };
  }
  // A correction says back only the part that changed. A newer complete map
  // supersedes older corrections, including a map split across messages.
  let mapEnd = map?.end ?? -1;
  if (selves) for (const [field, key] of [['eight', 'read.first.fix_eight'], ['eighty', 'read.first.fix_eighty'], ['goals', 'read.first.fix']] as const) {
    const fix = readBackSpan(said, script.get(key));
    if (fix && fix.end > (map?.end ?? -1) && fix.values[field]) {
      selves[field] = fix.values[field]!;
      mapEnd = Math.max(mapEnd, fix.end);
    }
  }
  const belief = readBack(said, script.get('belief.name'))?.['belief'];
  const noPrevious = script.get('open.return.no_action');
  const week = noPrevious && said.some(t => carries(t, noPrevious)) ? undefined : lastWeek(said, script);
  const changeSlot = script.get('setup.change_slot');
  const wantsSlotChange = !!changeSlot && said.some((t) => carries(t, changeSlot));
  const confirmed = script.get('onboarding.confirmed');
  const mappedAt = mapEnd < 0 ? -1 : positions[mapEnd] ?? -1;
  const confirmedAt = transcript.turns.findLastIndex(t => t.speaker === 'agent' && !!confirmed && carries(t.text, confirmed));
  const onboardingComplete = !!selves && mappedAt >= 0 && confirmedAt > mappedAt
    && confirmsMap(transcript.turns.slice(mappedAt + 1, confirmedAt));

  const outcome: CallOutcome = {
    at: now.toISOString(),
    durationMs: transcript.durationMs,
    ...(onboardingComplete ? { onboardingComplete: true } : {}),
    ...(commitment ? { commitment: commitment.text, ...(commitment.day ? { day: commitment.day } : {}) } : {}),
    ...(noAction ? { noAction: true } : {}),
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
/** A clear acknowledgement, rather than treating any caller speech as agreement.
 * Unknown phrasing leaves onboarding unfinished; the saved map can be checked
 * next time. This deliberately does not try to infer agreement from a story.
 */
function confirmsMap(turns: readonly Turn[]): boolean {
  const answer = normalise(turns.filter(t => t.speaker === 'caller').map(t => t.text).join(' '));
  if (/\b(no|nope|none|not|wrong|incorrect|but|except|nej|nei|ikke|feil|men)\b/.test(answer)) return false;
  return /^(yes|yeah|yep|exactly|correct|right|thats right|that is right|you got it|ja|stemmer|riktig|det stemmer)\b/.test(answer);
}

/** Narrow explicit choices, not a general intent classifier. */
function explicitNoAction(text: string): boolean {
  return /^(actually |then )?(no (new )?(action|commitment)( this week)?|i (dont|do not) want (an action|a commitment)|ingen (handling|forpliktelse)( denne uken)?)\b/.test(normalise(text));
}
