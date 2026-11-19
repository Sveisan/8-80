import { nextSlotAfter } from '../schedule/time.ts';
import { DEFAULT_LIGHT_DAYS, DEFAULT_LIGHT_MINUTE } from './model.ts';

const ZONE = 'Europe/Oslo';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Actual instants for the initial daytime suggestions; the form displays these in the caller's timezone. */
export function suggestedTimes(now = new Date()): { opening: Date; regular: Date; light: Date[] } {
  const after = new Date(+now + 86400_000);
  const opening = new Date(Math.min(...[1, 2, 3, 4, 5].map(weekday => +nextSlotAfter(after, { weekday, minute: 15 * 60, timezone: ZONE }))));
  return {
    opening,
    regular: nextSlotAfter(now, { weekday: 1, minute: 15 * 60, timezone: ZONE }),
    light: DEFAULT_LIGHT_DAYS.map(weekday => nextSlotAfter(now, { weekday, minute: DEFAULT_LIGHT_MINUTE, timezone: ZONE })),
  };
}
export function suggestedLocal(at: Date, timezone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return { weekday: WEEKDAYS.indexOf(part('weekday')), time: `${part('hour')}:${part('minute')}` };
}
