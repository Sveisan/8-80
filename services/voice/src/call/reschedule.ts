import type { ScriptLines } from '../script.ts';
import { localDate, parseWeekday, zonedTimeToUtc } from '../schedule/time.ts';

/**
 * A time the mentor agreed to ring back at, taken from its own read-back.
 *
 * The same rule as `commitment.ts`, for the same reason: the caller says "some
 * time after lunch, I'm in a shop" and the mentor says "Fine. I'll ring you
 * back at 17:30 today." Only the second of those is ours, only the second is
 * unambiguous, and only the second means the mentor actually agreed. Parsing
 * the caller's side would move calls on the strength of somebody thinking out
 * loud.
 */
export interface SpokenTime {
  /** Local clock, in the caller's own zone. */
  hour: number;
  minute: number;
  /** 'today', 'tomorrow', or 0–6 for a named weekday. Absent means the soonest. */
  day?: 'today' | 'tomorrow' | number;
}

/**
 * Light enough to keep a clock time intact.
 *
 * `normalise` from the endpointer cannot be used here: it strips digits, which
 * for reading pauses is right and here deletes the entire answer. Punctuation
 * and apostrophes go, digits, colons and full stops stay.
 */
const loosen = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^a-z0-9:.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Digits only. See SCRIPT.md §9c: "half five" is not a time this can act on. */
const CLOCK = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/;
const BARE_HOUR = /\b(1[0-2]|[1-9])\s*(am|pm)\b/;

/**
 * The hours a callback may land in, on the caller's own clock.
 *
 * The mentor's read-back is written by a model, and a model can be talked into
 * saying most things — including "I'll ring you back at 03:00" by somebody who
 * did not mean it, or by nothing at all. The weekly slot is set deliberately
 * through `enrol` and is not bounded here; an ad-hoc callback agreed mid-call
 * is, because a phone ringing at four in the morning is a bug whichever way it
 * got there.
 */
const EARLIEST = Number(process.env['CALLBACK_EARLIEST_HOUR'] ?? 7);
const LATEST = Number(process.env['CALLBACK_LATEST_HOUR'] ?? 21);

export function extractReschedule(spoken: string, script: ScriptLines): SpokenTime | undefined {
  const template = script.get('reschedule.confirm');
  if (!template) return undefined;

  // Anchor on the fixed words immediately before the slot, so the phrasing
  // stays editable in SCRIPT.md. Without an anchor, any clock time anywhere in
  // the call — "I'll call you Friday at 08:30" in the close — would move the
  // week. The last few words rather than the whole opening, because the first
  // word of a spoken line is the one most likely to come out differently:
  // "Fine." and "Right." are the same agreement and "ring you back at" is not.
  const [before] = template.split('{{time}}');
  const head = loosen(before ?? '').split(' ').slice(-4).join(' ');
  if (head.length < 6) return undefined;

  const said = loosen(spoken);
  const at = said.lastIndexOf(head);
  if (at < 0) return undefined;
  // Only what follows the agreement, and not the rest of the call after it.
  const rest = said.slice(at + head.length).slice(0, 60);

  const clock = CLOCK.exec(rest);
  const bare = clock ? undefined : BARE_HOUR.exec(rest);
  if (!clock && !bare) return undefined;

  let hour = Number(clock ? clock[1] : bare?.[1]);
  const minute = clock ? Number(clock[2]) : 0;
  const meridiem = (clock?.[3] ?? bare?.[2])?.toLowerCase();
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  if (hour < EARLIEST || hour > LATEST) return undefined;

  // parseWeekday wants a weekday and nothing else; this is a phrase. Each word
  // is offered to it rather than reimplementing the names in a second place.
  const weekday = rest
    .split(/[\s.]+/)
    .map((w) => parseWeekday(w))
    .find((d) => d !== undefined);
  const day: SpokenTime['day'] = /\btomorrow\b/.test(rest)
    ? 'tomorrow'
    : /\btoday\b/.test(rest)
      ? 'today'
      : weekday !== undefined
        ? weekday
        : undefined;

  return { hour, minute, ...(day !== undefined ? { day } : {}) };
}

/**
 * The spoken time as an instant, in the caller's zone.
 *
 * Always in the future. A mentor that says "I'll ring you back at 17:30" during
 * a call at 18:05 meant tomorrow, and a time in the past would be claimed by
 * the very next tick — ringing somebody back four seconds after agreeing not
 * to, which is the most annoying possible reading of the words.
 */
export function resolveSpokenTime(spoken: SpokenTime, timezone: string, after: Date): Date {
  const here = localDate(after, timezone);

  let offsetDays = 0;
  if (spoken.day === 'tomorrow') offsetDays = 1;
  else if (typeof spoken.day === 'number') offsetDays = (spoken.day - here.weekday + 7) % 7;

  const minuteOfDay = spoken.hour * 60 + spoken.minute;
  // Days are added through UTC arithmetic on the local calendar date, then the
  // zone is applied once at the end — the same two-pass trick as nextSlotAfter,
  // and for the same reason: adding 24 hours to an instant is wrong twice a year.
  const dayAt = (extra: number): Date => {
    const shifted = new Date(Date.UTC(here.year, here.month - 1, here.day + offsetDays + extra));
    return zonedTimeToUtc(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), minuteOfDay, timezone);
  };

  // "today at nine" said at ten in the evening, or a weekday that is today and
  // already gone: what was meant is the soonest one still ahead. A time in the
  // past would be claimed by the next tick, ringing back four seconds after
  // agreeing not to.
  const step = typeof spoken.day === 'number' ? 7 : 1;
  let when = dayAt(0);
  for (let i = 1; when.getTime() <= after.getTime() && i <= 8; i++) when = dayAt(step * i);
  return when;
}
