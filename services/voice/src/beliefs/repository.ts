import { randomUUID } from 'node:crypto';
import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import { decrypt, encrypt } from '../store/crypto.ts';
import { nextSlotAfter, parseLocalTime, parseWeekday, zonedTimeToUtc } from '../schedule/time.ts';
import { applyCommand, emptyPractice, PracticeError, type Command, type Practice } from './model.ts';
import { withinCoverage } from './coverage.ts';

export interface Enrollment {
  id: string; is_current: boolean; checkout_reference: string; phone_hash: string; practice_enc: string; revision: number; timezone: string;
  daily_minute: number | null; weekly_weekday: number | null; weekly_minute: number | null;
  onboarding_at: Date | null; next_daily_at: Date | null; next_weekly_at: Date | null; review_origin: Date | null;
  daily_resume_at: Date | null; weekly_resume_at: Date | null;
  product_id:string|null; standing: string; provider: 'stripe' | 'lemonsqueezy' | null; purchase_id: string | null; payment_id: string | null;
  first_connected_at: Date | null; completed_at: Date | null; history_delete_at: Date | null; history_deleted_at: Date | null; retention_notice_at: Date | null; retention_delivered_at: Date | null;
  checkin_at: Date | null; checkin_used_at: Date | null; checkin_attempt_id: string | null; correction_count: number;
  customer_id: string | null; paid_at: Date | null; amount_minor: number | null; currency: string | null;
}
export function nextDaily(after: Date, minute: number, timezone: string): Date {
  return new Date(Math.min(...Array.from({ length: 7 }, (_, weekday) =>
    +nextSlotAfter(after, { weekday, minute, timezone }))));
}
export function scheduleInput(form: URLSearchParams, now = new Date(), needsOnboarding = true) {
  const timezone = (form.get('timezone') ?? '').trim() || 'Europe/Oslo';
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(now); }
  catch { throw new PracticeError('timezone_invalid'); }
  const daily = parseLocalTime(form.get('daily') ?? '');
  const weekly = parseLocalTime(form.get('weekly') ?? '');
  const weekday = parseWeekday(form.get('weekday') ?? '');
  if (daily === undefined || weekly === undefined || weekday === undefined) throw new PracticeError('schedule_invalid');
  if (Math.min(Math.abs(daily - weekly), 1440 - Math.abs(daily - weekly)) < 45) throw new PracticeError('calls_too_close');
  const at=needsOnboarding ? appointmentInput(form,timezone,now,'onboarding') : null;
  return { timezone, daily, weekly, weekday, at };
}
export function appointmentInput(form: URLSearchParams, timezone: string, now = new Date(), name='occurrence'): Date {
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(form.get(name+'_local') ?? '');
  if (local) {
    const [year, month, day, hour, minute] = local.slice(1).map(Number);
    const calendar = new Date(Date.UTC(year!, month! - 1, day!));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month! - 1 || calendar.getUTCDate() !== day || hour! > 23 || minute! > 59) throw new PracticeError('onboarding_time_invalid');
  }
  const at = local ? zonedTimeToUtc(Number(local[1]),Number(local[2]),Number(local[3]),Number(local[4])*60+Number(local[5]),timezone) : new Date(form.get(name) ?? '');
  if (!Number.isFinite(+at) || at <= now || +at > +now + 30 * 86400_000) throw new PracticeError('onboarding_time_invalid');
  if(local && new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,dateStyle:'short',timeStyle:'short'}).format(at).replace(' ','T')!==form.get(name+'_local'))throw new PracticeError('nonexistent_local_time');
  return at;
}

export class BeliefRepository {
  constructor(readonly sql: Database, readonly programmeId?: string) {}
  async load(hash: string): Promise<{ enrollment: Enrollment; practice: Practice } | undefined> {
    const [enrollment] = await this.sql<Enrollment[]>`select * from belief_enrollments where phone_hash = ${hash} and (${this.programmeId ?? null}::text is not null and id=${this.programmeId ?? null} or ${this.programmeId ?? null}::text is null and is_current)`;
    return enrollment ? { enrollment, practice: JSON.parse(decrypt(enrollment.practice_enc)) as Practice } : undefined;
  }
  async enroll(hash: string, now = new Date(), contact?: {name:string;email:string}): Promise<void> {
    const practice=emptyPractice();
    if(contact && (contact.name.trim() || contact.email.trim()))practice.contact={name:contact.name.trim().slice(0,80),email:contact.email.trim().slice(0,254)};
    const id=randomUUID();
    await this.sql`insert into belief_enrollments (id,checkout_reference,phone_hash, practice_enc, consent_version, consent_at)
      values (${id},${'beliefs:'+id},${hash}, ${encrypt(JSON.stringify(practice))}, 'beliefs-v1', ${now}) on conflict do nothing`;
  }
  async command(hash: string, command: Command, eventId: string, expected?: number, now = new Date()): Promise<Practice> {
    return transaction(this.sql, async tx => {
      await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
      const [row] = await tx<Enrollment[]>`select * from belief_enrollments where phone_hash = ${hash} and (${this.programmeId ?? null}::text is not null and id=${this.programmeId ?? null} or ${this.programmeId ?? null}::text is null and is_current) for update`;
      if (!row) throw new PracticeError('enrollment_unknown');
      if(row.history_deleted_at)throw new PracticeError('history_deleted');
      const current = JSON.parse(decrypt(row.practice_enc)) as Practice;
      if (current.events.includes(eventId)) return applyCommand(current,command,eventId,now);
      if (expected !== undefined && expected !== current.revision) throw new PracticeError('page_changed');
      const practice = applyCommand(current, command, eventId, now);
      return this.write(tx,row,current,practice,now);
    });
  }
  /** Preserve IDs generated during discovery; commit the verified aggregate atomically. */
  async confirm(hash: string, expected: number, practice: Practice, now = new Date()): Promise<Practice> {
    return transaction(this.sql,async tx=>{
      await tx`select phone_hash from callers where phone_hash=${hash} for update`;
      const [row]=await tx<Enrollment[]>`select * from belief_enrollments where phone_hash=${hash} and (${this.programmeId ?? null}::text is not null and id=${this.programmeId ?? null} or ${this.programmeId ?? null}::text is null and is_current) for update`;
      if(!row)throw new PracticeError('enrollment_unknown');
      if(row.history_deleted_at)throw new PracticeError('history_deleted');
      const current=JSON.parse(decrypt(row.practice_enc)) as Practice;
      if(current.revision!==expected || practice.revision<expected)throw new PracticeError('page_changed');
      return this.write(tx,row,current,practice,now);
    });
  }
  private async write(sql: Database,row: Enrollment,current: Practice,practice: Practice,now: Date): Promise<Practice> {
    const corrected = current.state==='completed' && practice.state!=='completed';
    const started = (!current.understood && practice.understood || corrected)  && row.daily_minute !== null && row.weekly_minute !== null && row.weekly_weekday !== null;
    const resumed=current.state==='paused' && practice.state==='active';
    const dailyDue=started || resumed && (!row.next_daily_at || row.next_daily_at<=now);
    const weeklyDue=started || resumed && (!row.next_weekly_at || row.next_weekly_at<=now);
    const nextWeekly = weeklyDue && row.weekly_minute!==null && row.weekly_weekday!==null ? nextSlotAfter(now, { minute: row.weekly_minute, weekday: row.weekly_weekday, timezone: row.timezone }) : row.next_weekly_at;
    await sql`update belief_enrollments set policy_checked_at=${now}, practice_enc = ${encrypt(JSON.stringify(practice))}, revision = ${practice.revision},
      completed_at = case when ${corrected} then null when ${practice.state==='completed'} then coalesce(completed_at, ${now}) else completed_at end,
      history_delete_at = case when ${corrected} then null when ${practice.state==='completed'} then coalesce(history_delete_at, ${now}::timestamptz + interval '12 months') else history_delete_at end,
      retention_delivered_at = case when ${corrected} then null else retention_delivered_at end,
      retention_notice_at = case when ${corrected} then null else retention_notice_at end,
      correction_count = correction_count + ${corrected?1:0}, checkin_at=case when ${corrected} then null else checkin_at end,
      next_daily_at = ${practice.state==='completed'?null:dailyDue && row.daily_minute!==null ? nextDaily(now, row.daily_minute, row.timezone) : row.next_daily_at},
      next_weekly_at = ${practice.state==='completed'?null:nextWeekly}, review_origin = ${started ? nextWeekly : row.review_origin},
      onboarding_at = case when ${started || practice.state==='completed'} then null else onboarding_at end,
      daily_resume_at = case when ${practice.state==='completed'} then null else daily_resume_at end,
      weekly_resume_at = case when ${practice.state==='completed'} then null else weekly_resume_at end, updated_at = ${now} where id = ${row.id}`;
    return practice;
  }
  async schedule(hash: string, form: URLSearchParams, now = new Date()): Promise<void> {
    await transaction(this.sql, async tx => {
      const [caller] = await tx`select slot_weekday, slot_minute, timezone from callers where phone_hash = ${hash} for update`;
      if (!caller) throw new PracticeError('enrollment_unknown');
      const loaded = await new BeliefRepository(tx,this.programmeId).load(hash);
      if (!loaded) throw new PracticeError('enrollment_unknown');
      if(loaded.practice.state==='completed')throw new PracticeError('programme_complete');
      const s = scheduleInput(form, now, !loaded.practice.understood);
      if (caller['slot_weekday'] !== null && caller['slot_minute'] !== null && caller['timezone'] === s.timezone) {
        const baseMinute = Number(caller['slot_minute']);
        const apart = (minute: number) => Math.min(Math.abs(baseMinute - minute), 1440 - Math.abs(baseMinute - minute));
        if (apart(s.daily) < 45 || (caller['slot_weekday'] === s.weekday && apart(s.weekly) < 45)) throw new PracticeError('base_calls_too_close');
      }
      if(caller['slot_weekday']!==null && caller['slot_minute']!==null){
        const base={weekday:Number(caller['slot_weekday']),minute:Number(caller['slot_minute']),timezone:String(caller['timezone'])};
        const appointments=s.at?[s.at]:[];let daily=now;let weekly=now;
        for(let i=0;i<35;i++){daily=nextDaily(daily,s.daily,s.timezone);appointments.push(daily);}
        for(let i=0;i<6;i++){weekly=nextSlotAfter(weekly,{weekday:s.weekday,minute:s.weekly,timezone:s.timezone});appointments.push(weekly);}
        if(appointments.some(at=>Math.abs(+at-+nextSlotAfter(new Date(+at-45*60_000),base))<45*60_000))throw new PracticeError('base_calls_too_close');
      }
      const weekly = nextSlotAfter(now, { minute: s.weekly, weekday: s.weekday, timezone: s.timezone });
      await tx`update belief_enrollments set timezone = ${s.timezone}, daily_minute = ${s.daily}, weekly_weekday = ${s.weekday}, weekly_minute = ${s.weekly},
        onboarding_at = ${loaded.practice.understood ? null : s.at},
        next_daily_at = ${loaded.practice.understood ? nextDaily(now, s.daily, s.timezone) : null},
        next_weekly_at = ${loaded.practice.understood ? weekly : null},
        daily_resume_at = null, weekly_resume_at = null,
        review_origin = coalesce(review_origin, ${loaded.practice.understood ? weekly : null}), updated_at = ${now} where id = ${loaded.enrollment.id}`;
    });
  }
  /** Move/skip one claimed future appointment, without changing the usual cadence. */
  async occurrence(hash:string,form:URLSearchParams,now=new Date()):Promise<void> {
    await transaction(this.sql,async tx=>{
      const [caller]=await tx`select held_for_review,all_calls_stopped,sms_opt_out,slot_weekday,slot_minute,timezone from callers where phone_hash=${hash} for update`;
      const loaded=await new BeliefRepository(tx,this.programmeId).load(hash);
      if(!caller || !loaded)throw new PracticeError('enrollment_unknown');
      const {enrollment:e,practice:p}=loaded;
      if(e.standing!=='active' || caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'] || ['paused','completed'].includes(p.state))throw new PracticeError('calls_held');
      const kind=form.get('kind');
      if(!['onboarding','daily','weekly'].includes(kind??'') || (!p.understood && kind!=='onboarding') || (p.understood && kind==='onboarding'))throw new PracticeError('schedule_invalid');
      const current=kind==='onboarding'?e.onboarding_at:kind==='daily'?e.next_daily_at:e.next_weekly_at;
      if(!current || current<=now || current.toISOString()!==form.get('expected_at'))throw new PracticeError('page_changed');
      const inflight=await tx`select id from call_attempts where phone_hash=${hash} and status in ('claimed','placed','settling') limit 1`;
      if(inflight.length)throw new PracticeError('call_in_progress');
      const following=kind==='onboarding'?null:kind==='daily'?(e.daily_resume_at ?? nextDaily(current,e.daily_minute!,e.timezone)):(e.weekly_resume_at ?? nextSlotAfter(current,{weekday:e.weekly_weekday!,minute:e.weekly_minute!,timezone:e.timezone}));
      const at=form.get('action')==='skip'?following:appointmentInput(form,e.timezone,now);
      if(at && form.get('action')!=='skip'){
        if(following && at>=following)throw new PracticeError('occurrence_too_late');
        if(!withinCoverage(at))throw new PracticeError('outside_coverage');
        const nearby:Date[]=[];
        const before=new Date(+at-45*60_000);
        if(p.understood && kind!=='daily' && e.daily_minute!==null)nearby.push(nextDaily(before,e.daily_minute,e.timezone));
        if(p.understood && kind!=='weekly' && e.weekly_minute!==null && e.weekly_weekday!==null)nearby.push(nextSlotAfter(before,{weekday:e.weekly_weekday,minute:e.weekly_minute,timezone:e.timezone}));
        if(kind!=='daily' && e.next_daily_at)nearby.push(e.next_daily_at);
        if(kind!=='weekly' && e.next_weekly_at)nearby.push(e.next_weekly_at);
        if(caller['slot_weekday']!==null && caller['slot_minute']!==null)nearby.push(nextSlotAfter(before,{weekday:Number(caller['slot_weekday']),minute:Number(caller['slot_minute']),timezone:String(caller['timezone'])}));
        if(nearby.some(other=>Math.abs(+at-+other)<45*60_000))throw new PracticeError('calls_too_close');
      }
      if(kind==='onboarding')await tx`update belief_enrollments set onboarding_at=${at},updated_at=${now} where id=${e.id}`;
      if(kind==='daily')await tx`update belief_enrollments set next_daily_at=${at},daily_resume_at=${form.get('action')==='skip'?null:following},updated_at=${now} where id=${e.id}`;
      if(kind==='weekly')await tx`update belief_enrollments set next_weekly_at=${at},weekly_resume_at=${form.get('action')==='skip'?null:following},updated_at=${now} where id=${e.id}`;
    });
  }
}
