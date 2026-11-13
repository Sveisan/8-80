import { config } from '../config.ts';
import { parseLocalTime } from '../schedule/time.ts';
import { unblockConfig } from './config.ts';
/** The staffed safety-response window. Calls are placed only inside it. */
export function coverageReady(): boolean {
  const c = unblockConfig(); return parseLocalTime(c.coverageStart) !== undefined && (parseLocalTime(c.coverageEnd) !== undefined || c.coverageEnd === '24:00') && c.coverageStart !== c.coverageEnd;
}
export function withinCoverage(at: Date): boolean {
  if (!coverageReady()) return false;
  const c = unblockConfig(); const start = parseLocalTime(c.coverageStart)!; const end = c.coverageEnd === '24:00' ? 1440 : parseLocalTime(c.coverageEnd)!;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: config.operator.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const minute = Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
