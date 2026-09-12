/**
 * Weekly slots in the caller's own timezone.
 *
 * A slot is "Tuesday at 08:00, Europe/Oslo". Storing that as a UTC instant and
 * adding seven days is wrong twice a year: the call arrives at 07:00 one week
 * in spring and 09:00 one week in autumn, which for a call whose entire
 * proposition is that it turns up when it said it would is not a rounding
 * error. So the slot is stored as weekday plus local minutes plus zone, and the
 * UTC instant is computed fresh each time.
 */

export interface Slot {
  /** 0 = Sunday, matching Date.getUTCDay. */
  weekday: number;
  /** Minutes past local midnight. 8am is 480. */
  minute: number;
  /** IANA zone, e.g. Europe/Oslo. */
  timezone: string;
}

const FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = FORMAT_CACHE.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMAT_CACHE.set(timezone, f);
  }
  return f;
}

/** The wall clock a zone shows at an instant, as if it were UTC. */
function wallClock(instant: Date, timezone: string): number {
  const parts = formatter(timezone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Intl renders midnight as hour 24 in some engines; Date.UTC normalises it.
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetAt(instant: Date, timezone: string): number {
  return wallClock(instant, timezone) - instant.getTime();
}

/**
 * The UTC instant at which a zone's clock reads this local time.
 *
 * Two passes, because the offset depends on the answer: guess using the offset
 * at the naive instant, then correct using the offset at the guess. That
 * settles every case except the hour that does not exist on a spring-forward
 * morning, where it lands on the instant immediately after the jump — the call
 * goes out at 03:00 rather than never, which is the right failure.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timezone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const once = naive - offsetAt(new Date(naive), timezone);
  return new Date(naive - offsetAt(new Date(once), timezone));
}

/** The local calendar date a zone is showing at an instant. */
function localDate(instant: Date, timezone: string): { year: number; month: number; day: number; weekday: number } {
  const wall = new Date(wallClock(instant, timezone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    weekday: wall.getUTCDay(),
  };
}

/**
 * The first time this slot comes round strictly after `after`.
 *
 * Strictly, so that advancing a slot the instant it fires moves to next week
 * rather than returning the same moment and calling twice.
 */
export function nextSlotAfter(after: Date, slot: Slot): Date {
  const here = localDate(after, slot.timezone);
  const ahead = (slot.weekday - here.weekday + 7) % 7;
  // Check today and the matching weekday; today can still be ahead of `after`
  // if the slot time has not passed, and the +7 covers the case where it has.
  for (const days of [ahead, ahead + 7]) {
    const probe = new Date(Date.UTC(here.year, here.month - 1, here.day + days));
    const at = zonedTimeToUtc(
      probe.getUTCFullYear(),
      probe.getUTCMonth() + 1,
      probe.getUTCDate(),
      slot.minute,
      slot.timezone,
    );
    if (at.getTime() > after.getTime()) return at;
  }
  /* c8 ignore next */
  throw new Error(`No occurrence of weekday ${slot.weekday} within a fortnight, which cannot happen`);
}

/** "tuesday" / "Tue" / "2" → 0..6, or undefined if it is not a weekday. */
export function parseWeekday(text: string): number | undefined {
  const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const want = text.trim().toLowerCase();
  const byName = names.findIndex((n) => n === want || n.slice(0, 3) === want);
  if (byName >= 0) return byName;
  const n = Number(want);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : undefined;
}

/** "08:00" → 480. */
export function parseLocalTime(text: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return h * 60 + min;
}
