import { nextSlotAfter, parseLocalTime, parseWeekday, type Slot } from '../schedule/time.ts';

export type Reply =
  /** Try again later today, without touching the slot. */
  | { kind: 'later' }
  /** Leave this week entirely. */
  | { kind: 'skip' }
  /** A day and a time. `always` means change the standing slot, not just this week. */
  | { kind: 'move'; weekday: number; minute: number; always: boolean }
  /** Not understood, and not guessed at. */
  | { kind: 'unparsed' };

const LATER = ['later', 'tonight', 'this evening', 'in a bit', 'try again', 'call me later'];
const SKIP = ['skip', 'pause', 'not this week', 'no thanks', 'next week'];
const ALWAYS = ['always', 'every week', 'from now on', 'permanently', 'for good'];
/**
 * A refusal with nothing schedulable in it. Erring towards not ringing somebody
 * is always the safer error here — see `parseReply`.
 */
const NEGATION = [' not ', "n't", 'cannot', 'no thanks', 'nope', 'unable'];

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** "half eight", "half past eight", "half past seven" — said out loud, not typed. */
const HALF = /\bhalf (?:past )?(\d{1,2}|[a-z]+)\b/;
/** "at 9", "9am", "9 pm", "09.30", "9:30" */
const CLOCK = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/;

/**
 * What a missed-call text meant.
 *
 * Rules rather than a model, deliberately. The set of things somebody types here
 * is small and the cost of a confident wrong answer is high: "not this week, I'm
 * at my mother's funeral" read as a reschedule request is the kind of failure
 * that ends the relationship. So anything outside the small set comes back as
 * `unparsed` and gets a human answer, and the parser never guesses to seem
 * clever.
 *
 * The `skip` check runs before the day check for exactly that reason — "not this
 * week" contains no weekday but does contain an intention, and a parser that
 * scanned for days first would find none and fall through to guessing.
 */
export function parseReply(text: string): Reply {
  const said = text.toLowerCase().trim();
  if (!said) return { kind: 'unparsed' };

  if (SKIP.some((p) => said.includes(p))) return { kind: 'skip' };
  if (LATER.some((p) => said.includes(p))) return { kind: 'later' };

  const weekday = findWeekday(said);
  const minute = findMinute(said);
  if (weekday !== undefined && minute !== undefined) {
    return { kind: 'move', weekday, minute, always: ALWAYS.some((p) => said.includes(p)) };
  }

  // A refusal we cannot schedule is a refusal. Answering "I didn't follow that
  // one" to somebody who has just said they cannot make it — and who may have
  // said why — is worse than quietly leaving the week, and leaving a week costs
  // nothing that cannot be undone next Tuesday.
  if (NEGATION.some((p) => ` ${said} `.includes(p))) return { kind: 'skip' };

  return { kind: 'unparsed' };
}

function findWeekday(said: string): number | undefined {
  for (const word of said.split(/[^a-z]+/)) {
    if (!/[a-z]/.test(word)) continue;
    // "wednesdays" is how somebody writes a standing arrangement.
    const day = parseWeekday(word) ?? (word.endsWith('s') ? parseWeekday(word.slice(0, -1)) : undefined);
    if (day !== undefined) return day;
  }
  return undefined;
}

function findMinute(said: string): number | undefined {
  const half = HALF.exec(said);
  if (half) {
    const raw = half[1] as string;
    const h = WORDS[raw] ?? Number(raw);
    return Number.isFinite(h) && h <= 23 ? hour24(h, said) * 60 + 30 : undefined;
  }

  const exact = parseLocalTime(said);
  if (exact !== undefined) return exact;

  for (const [word, h] of Object.entries(WORDS)) {
    if (new RegExp(`\\b(?:at )?${word}\\b`).test(said)) return hour24(h, said) * 60;
  }

  const clock = CLOCK.exec(said);
  if (!clock) return undefined;
  const h = Number(clock[1]);
  const m = clock[2] ? Number(clock[2]) : 0;
  if (h > 23 || m > 59) return undefined;
  const meridiem = clock[3];
  if (meridiem === 'pm') return ((h % 12) + 12) * 60 + m;
  if (meridiem === 'am') return (h % 12) * 60 + m;
  return hour24(h, said) * 60 + m;
}

/**
 * A bare "9" from someone rescheduling a morning call means nine in the morning.
 *
 * No meridiem and no context would make "9" ambiguous, so the rule is: numbers
 * that read as a working hour are taken at face value, and 1 through 6 are read
 * as afternoon, because nobody reschedules a call to four in the morning.
 */
function hour24(h: number, said: string): number {
  if (said.includes('morning')) return h % 12;
  if (said.includes('evening') || said.includes('afternoon')) return (h % 12) + 12;
  return h >= 1 && h <= 6 ? h + 12 : h;
}

/** When a `move` reply actually lands, given the caller's zone. */
export function moveTo(reply: Extract<Reply, { kind: 'move' }>, timezone: string, now = new Date()): Date {
  const slot: Slot = { weekday: reply.weekday, minute: reply.minute, timezone };
  return nextSlotAfter(now, slot);
}
