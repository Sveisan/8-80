import { localDate, nextSlotAfter, parseLocalTime, zonedTimeToUtc, type Slot } from '../schedule/time.ts';

export interface MoveDraft {
  scope: 'first' | 'once' | 'weekly';
  day: string;
  time: string;
}

export function moveVersion(slot: Slot, scheduledAt?: Date): string {
  return JSON.stringify([slot.weekday, slot.minute, slot.timezone, scheduledAt?.toISOString() ?? null]);
}

/** A UTC date used for displaying and comparing calendar days in the booking zone. */
export function bookingDay(at: Date, timezone: string): Date {
  const { year, month, day } = localDate(at, timezone);
  return new Date(Date.UTC(year, month - 1, day));
}

export const dayValue = (date: Date): string => date.toISOString().slice(0, 10);

export function bookingDays(now: Date, timezone: string, scheduledAt?: Date): Date[] {
  const today = bookingDay(now, timezone);
  const dates = Array.from({ length: 8 }, (_, offset) => new Date(+today + offset * 86400_000));
  if (scheduledAt) {
    const date = bookingDay(scheduledAt, timezone);
    if (date > dates[7]!) dates.push(date);
  }
  return dates;
}

export function readMove(form: URLSearchParams, beforeFirst: boolean): MoveDraft | undefined {
  const scope = form.get('scope');
  const day = form.get('day') ?? '';
  const time = form.get('time') ?? '';
  if (scope !== 'first' && scope !== 'once' && scope !== 'weekly') return undefined;
  if (beforeFirst !== (scope === 'first')) return undefined;
  if (parseLocalTime(time) === undefined || day.length > 10) return undefined;
  return { scope, day, time };
}

export function proposedMove(draft: MoveDraft, slot: Slot, now: Date, scheduledAt?: Date): { at: Date; weekly?: Slot } | undefined {
  const minute = parseLocalTime(draft.time);
  if (minute === undefined) return undefined;
  if (draft.scope === 'weekly') {
    if (!/^[0-6]$/.test(draft.day)) return undefined;
    const weekly = { weekday: Number(draft.day), minute, timezone: slot.timezone };
    return { at: nextSlotAfter(now, weekly), weekly };
  }
  const date = bookingDays(now, slot.timezone, scheduledAt).find(candidate => dayValue(candidate) === draft.day);
  if (!date) return undefined;
  const at = zonedTimeToUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), minute, slot.timezone);
  if (at <= now) return undefined;
  return draft.scope === 'first'
    ? { at, weekly: { weekday: date.getUTCDay(), minute, timezone: slot.timezone } }
    : { at };
}
