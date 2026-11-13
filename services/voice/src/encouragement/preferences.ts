import type { Database } from '../store/transaction.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { sameMessageNumber } from '../agent/voices.ts';
import { canRemind } from '../weekly/reminders.ts';

export const frequencies = ['weekly', 'three', 'daily'] as const;
export const tones = ['gentle', 'practical', 'playful', 'direct'] as const;
export const topics = ['encouragement', 'recognition', 'action'] as const;
export interface Preferences {
  enabled: boolean; paused: boolean; frequency: typeof frequencies[number]; tone: typeof tones[number];
  content: (typeof topics[number])[]; swearing: boolean; quietStart: number; quietEnd: number;
  timezone: string; focus: string; revision: number; nextAt: Date | null;
}
export const defaults = (timezone = 'Europe/Oslo'): Preferences => ({ enabled:false, paused:false, frequency:'weekly', tone:'gentle',
  content:['encouragement'], swearing:false, quietStart:21*60, quietEnd:9*60, timezone, focus:'', revision:0, nextAt:null });
/** Two independent gates: a deploy cannot stand in for the successful phone test. */
export function available(hash: string, env = process.env): boolean {
  return sameMessageNumber(env) && (env['ENCOURAGEMENT_READY']==='1' && env['ENCOURAGEMENT_PHONE_TEST_PASSED']==='1'
    || (env['ENCOURAGEMENT_PILOT_HASHES']??'').split(',').filter(h=>/^[a-f0-9]{64}$/.test(h)).includes(hash));
}
const clocks=new Map<string,Intl.DateTimeFormat>();
export function localClock(at: Date, timezone: string): { day: string; minute: number; weekday: number } {
  let format=clocks.get(timezone);
  if(!format){format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'});if(clocks.size<100)clocks.set(timezone,format);}
  const parts = format.formatToParts(at);
  const get=(type:string)=>parts.find(p=>p.type===type)!.value;
  return {day:`${get('year')}-${get('month')}-${get('day')}`, minute:Number(get('hour'))*60+Number(get('minute')),
    weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'))};
}
export const isQuiet = (minute: number, p: Pick<Preferences,'quietStart'|'quietEnd'>): boolean =>
  p.quietStart < p.quietEnd ? minute>=p.quietStart && minute<p.quietEnd : minute>=p.quietStart || minute<p.quietEnd;
const scheduledDay = (weekday:number, frequency:Preferences['frequency']) => frequency==='daily' || (frequency==='weekly' ? weekday===2 : [1,3,5].includes(weekday));
/** Iterate real instants: DST gaps are skipped and repeated hours cannot create a second local day. */
export function nextAfter(now: Date, p: Preferences): Date {
  const today=localClock(now,p.timezone).day;
  for(let stamp=Math.floor(+now/60_000)*60_000+60_000;stamp<=+now+9*86400_000;stamp+=60_000){
    const at=new Date(stamp), local=localClock(at,p.timezone);
    if(local.day!==today && scheduledDay(local.weekday,p.frequency) && local.minute>=600 && !isQuiet(local.minute,p))return at;
  }
  throw new Error('No daytime delivery window.');
}
export function fromRow(r: Record<string,unknown>): Preferences {
  return {enabled:!!r['enabled'],paused:!!r['paused'],frequency:r['frequency'] as Preferences['frequency'],tone:r['tone'] as Preferences['tone'],
    content:JSON.parse(String(r['content'])),swearing:!!r['swearing'],quietStart:Number(r['quiet_start']),quietEnd:Number(r['quiet_end']),
    timezone:String(r['timezone']),focus:r['focus_enc']?decrypt(String(r['focus_enc'])):'',revision:Number(r['revision']),nextAt:r['next_at'] as Date|null};
}
export async function loadPreferences(sql:Database, hash:string, timezone?:string):Promise<Preferences>{
  const [row]=await sql`select * from encouragement_preferences where phone_hash=${hash}`;
  return row?fromRow(row):defaults(timezone);
}
export function parsePreferences(form: URLSearchParams): Preferences {
  const p=defaults();
  const frequency=form.get('frequency'),tone=form.get('tone'),content=form.getAll('content');
  if(!frequencies.includes(frequency as Preferences['frequency']) || !tones.includes(tone as Preferences['tone']) || !content.length || content.some(t=>!topics.includes(t as typeof topics[number])))throw new Error('Choose a frequency, tone and at least one message type.');
  const minute=(value:string|null)=> {if(!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new Error('Use valid quiet hours.');const [h,m]=value.split(':').map(Number);return h!*60+m!;};
  p.frequency=frequency as Preferences['frequency'];p.tone=tone as Preferences['tone'];p.content=[...new Set(content)] as Preferences['content'];
  p.enabled=form.get('enabled')==='yes';p.swearing=form.get('swearing')==='yes';p.quietStart=minute(form.get('quiet_start'));p.quietEnd=minute(form.get('quiet_end'));
  if(p.quietStart===p.quietEnd || !Array.from({length:840},(_,i)=>i+600).some(m=>!isQuiet(m,p)))throw new Error('Leave a delivery window between 10:00 and midnight, or pause messages.');
  p.timezone=form.get('timezone')??'';try{localClock(new Date(),p.timezone);}catch{throw new Error('Use a valid timezone, such as Europe/Oslo.');}
  p.focus=(form.get('focus')??'').trim();if(p.focus.length>160 || [...p.focus].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))throw new Error('Keep your focus to one line, up to 160 characters.');
  if(p.enabled && p.content.includes('action') && !p.focus)throw new Error('Add your chosen focus for action nudges.');
  return p;
}
/** Always lock caller before preferences/outbox, including feedback and dispatch. */
export async function savePreferences(sql:Database,hash:string,p:Preferences,now=new Date()):Promise<void>{
  if(!available(hash))throw new Error('Encouragement is still in a private pilot.');
  const [caller]=await sql`select phone_hash,sms_opt_out from callers where phone_hash=${hash} for update`;
  if(!caller)throw new Error('Account no longer exists.');
  if(p.enabled && caller['sms_opt_out'])throw new Error('SMS is stopped at the carrier. Restore SMS delivery before opting in.');
  const next=p.enabled&&!p.paused?nextAfter(now,p):null;
  await sql`insert into encouragement_preferences (phone_hash,enabled,paused,frequency,tone,content,swearing,quiet_start,quiet_end,timezone,focus_enc,revision,next_at,consented_at,updated_at)
    values (${hash},${p.enabled},${p.paused},${p.frequency},${p.tone},${JSON.stringify(p.content)},${p.swearing},${p.quietStart},${p.quietEnd},${p.timezone},${p.focus?encrypt(p.focus):null},1,${next},${p.enabled?now:null},${now})
    on conflict (phone_hash) do update set enabled=excluded.enabled,paused=excluded.paused,frequency=excluded.frequency,tone=excluded.tone,content=excluded.content,
      swearing=excluded.swearing,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,timezone=excluded.timezone,focus_enc=excluded.focus_enc,
      revision=encouragement_preferences.revision+1,next_at=excluded.next_at,
      consented_at=case when excluded.enabled and not encouragement_preferences.enabled then ${now} else encouragement_preferences.consented_at end,updated_at=${now}`;
  await sql`update message_outbox set status='suppressed',reason='encouragement_changed',payload_enc=null,recipient_enc=null where phone_hash=${hash} and kind='encouragement' and status='pending'`;
}
export function eligible(caller:Record<string,unknown>,now:Date):boolean{
  return canRemind(caller,now) && Number(caller['call_number'])>1 && ['complete','legacy'].includes(String(caller['onboarding']));
}
