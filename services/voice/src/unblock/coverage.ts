import { config } from '../config.ts';
import { parseLocalTime } from '../schedule/time.ts';
import { unblockConfig } from './config.ts';
const daysOf = (text: string): number[] => {
  const parts = text.split(',').map(d => d.trim());
  return parts.length && parts.every(d => /^[0-6]$/.test(d)) && new Set(parts).size === parts.length ? parts.map(Number) : [];
};
/** The staffed safety-response window. Calls are placed only inside it. */
export function coverageReady(): boolean {
  const c = unblockConfig(); return daysOf(c.coverageDays).length > 0 && parseLocalTime(c.coverageStart) !== undefined && (parseLocalTime(c.coverageEnd) !== undefined || c.coverageEnd === '24:00') && c.coverageStart !== c.coverageEnd;
}
export function withinCoverage(at: Date): boolean {
  if (!coverageReady()) return false;
  const c = unblockConfig(); const start = parseLocalTime(c.coverageStart)!; const end = c.coverageEnd === '24:00' ? 1440 : parseLocalTime(c.coverageEnd)!;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: config.operator.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find(p => p.type === 'weekday')!.value);
  if (!daysOf(c.coverageDays).includes(weekday)) return false;
  const minute = Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
/** Leave thirty minutes before staffed coverage ends. A configured 09:00–17:00 window permits starts through 16:30. */
export function withinCallWindow(at: Date): boolean {
  const minuteStart = Math.floor(+at / 60_000) * 60_000;
  return withinCoverage(at) && withinCoverage(new Date(minuteStart + 30 * 60_000 - 1));
}
