import { nextSlotAfter } from '../schedule/time.ts';

/**
 * Calendar for the monthly chapters. The chapter period is the subscription's billing month, anchored at first activation:
 * period k runs from addMonths(anchor, k) to addMonths(anchor, k + 1). Pure functions, no database.
 */
const DAY = 86400_000;
export function addMonths(anchor: Date, months: number): Date {
  const y = anchor.getUTCFullYear(), m = anchor.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchor.getUTCDate(), last), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
}
/** Start of the billing period that contains `at` (the anchor itself for anything earlier). */
export function periodStart(anchor: Date, at: Date): Date {
  let k = Math.max(0, (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + at.getUTCMonth() - anchor.getUTCMonth());
  while (k > 0 && addMonths(anchor, k) > at) k--;
  while (addMonths(anchor, k + 1) <= at) k++;
  return addMonths(anchor, k);
}
/** First billing-period boundary strictly after `at`. */
export function periodEnd(anchor: Date, at: Date): Date {
  const start = periodStart(anchor, at);
  for (let k = 1; ; k++) { const end = addMonths(anchor, k); if (end > start && end > at) return end; }
}

/**
 * Days a chapter's calls fall on. Up to four calls use the caller's weekday; five to eight add a second day three days later,
 * because one weekday occurs only four or five times in a month.
 */
export function weekdaysFor(weekday: number, calls: number): number[] {
  return calls > 4 ? [weekday, (weekday + 3) % 7].sort((a, b) => a - b) : [weekday];
}
export interface Cadence { timezone: string; weekdays: number[]; minute: number; }

/** Every slot strictly after `after` and strictly before `end`, in order. */
export function occurrences(c: Cadence, after: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (const weekday of c.weekdays) {
    for (let cursor = after; ;) {
      const at = nextSlotAfter(cursor, { weekday, minute: c.minute, timezone: c.timezone });
      if (at >= end) break;
      out.push(at); cursor = at;
    }
  }
  return out.sort((a, b) => +a - +b);
}
/** The first slot of any chosen weekday strictly after `after`. */
export function nextOccurrence(c: Cadence, after: Date): Date {
  return new Date(Math.min(...c.weekdays.map(weekday => +nextSlotAfter(after, { weekday, minute: c.minute, timezone: c.timezone }))));
}
/**
 * The next call, given that `remaining` calls (including it, ending with the close) still have to happen before `end`.
 * The slots left are spread so the close lands on the last slot: with m slots and r calls the next one is slot floor(m / r) - 1.
 * With fewer slots than calls every slot is used. Null when no slot is left before `end`.
 */
export function planNext(c: Cadence, after: Date, end: Date, remaining: number): Date | null {
  const slots = occurrences(c, after, end);
  if (!slots.length) return null;
  return slots[Math.max(0, Math.floor(slots.length / Math.max(1, remaining)) - 1)]!;
}
/** True when no slot of `c` remains between `after` and `end`, i.e. a call at `after` is the last chance in the period. */
export const lastSlot = (c: Cadence, at: Date, end: Date): boolean => nextOccurrence(c, at) >= end;

const WEEK = 7 * 1440;
const stamp = (weekday: number, minute: number): number => weekday * 1440 + minute;
/** The shortest distance, in minutes, between two weekly times (around the week, so Monday 23:50 and Tuesday 00:10 are 20 apart). */
export function weeklyDistance(a: number, b: number): number { const d = Math.abs(a - b) % WEEK; return Math.min(d, WEEK - d); }
/** True when any weekly time of `a` is within `gap` minutes of any weekly time of `b`. */
export function tooClose(a: readonly { weekday: number; minute: number }[], b: readonly { weekday: number; minute: number }[], gap = 45): boolean {
  return a.some(x => b.some(y => weeklyDistance(stamp(x.weekday, x.minute), stamp(y.weekday, y.minute)) < gap));
}
export { DAY };
