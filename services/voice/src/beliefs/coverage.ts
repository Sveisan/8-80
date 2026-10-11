import { config } from '../config.ts';
import { parseLocalTime } from '../schedule/time.ts';
import { beliefConfig } from './config.ts';
export function coverageReady():boolean {
  const c=beliefConfig();return parseLocalTime(c.coverageStart)!==undefined && (parseLocalTime(c.coverageEnd)!==undefined || c.coverageEnd==='24:00') && c.coverageStart!==c.coverageEnd;
}
export function withinCoverage(at:Date):boolean {
  if(!coverageReady())return false;
  const c=beliefConfig();const start=parseLocalTime(c.coverageStart)!;const end=c.coverageEnd==='24:00'?1440:parseLocalTime(c.coverageEnd)!;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:config.operator.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);
  const minute=Number(parts.find(p=>p.type==='hour')!.value)*60+Number(parts.find(p=>p.type==='minute')!.value);
  return start<end?minute>=start && minute<end:minute>=start || minute<end;
}
