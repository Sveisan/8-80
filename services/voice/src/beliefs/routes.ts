import type { IncomingMessage } from 'node:http';
import { config, smsConfigured } from '../config.ts';
import type { LoopDeps } from '../loop/deps.ts';
import type { Answer } from '../signup/routes.ts';
import { Pending } from '../signup/pending.ts';
import { TTL_MS } from '../signup/pending.ts';
import { readPhone, EMAIL } from '../signup/form.ts';
import { Limiter } from '../signup/limit.ts';
import { phoneKey } from '../store/postgres.ts';
import { encrypt } from '../store/crypto.ts';
import { Links } from '../link/token.ts';
import { cookieOf, crossSite } from '../link/cookie.ts';
import { AccessCodes } from '../access/codes.ts';
import { enqueue, dispatchMessage } from '../messages/outbox.ts';
import { describeAppointment } from '../schedule/time.ts';
import { beliefConfig } from './config.ts';
import { beliefReadiness } from './readiness.ts';
import { withinCoverage } from './coverage.ts';
import { nextSlotAfter } from '../schedule/time.ts';
import { deleteAccount } from '../billing/service.ts';
import { composeExport } from '../legal/export.ts';
import { beliefPage, aboutPage, clock, type PageOptions, type Screen } from './page.ts';
import { csrfFor, practiceCookie, readForm, pageHeaders } from './http.ts';
import { BeliefRepository, scheduleInput, nextDaily } from './repository.ts';
import { ProgrammePolicies, refundDeadline, guaranteedRefund } from './policies.ts';
import { beliefCheckout } from './billing.ts';
import { commandFrom, messages } from './forms.ts';
import { PracticeError, nextPracticeAppointment } from './model.ts';

const sends=new Limiter(8,3600_000);const verifies=new Limiter(30,600_000);
export async function beliefRoutes(req: IncomingMessage,url: URL,deps: LoopDeps,client: string,now=new Date()): Promise<Answer | undefined> {
  if (url.pathname !== '/beliefs' && !url.pathname.startsWith('/beliefs/')) return undefined;
  const c=beliefConfig();
  const ready=beliefReadiness().length===0;
  const options: PageOptions={available:ready,price:c.price,support:config.company.supportEmail()?`mailto:${config.company.supportEmail()}`:undefined,supportHours:c.supportHours};
  const page=(screen: Screen,status=200,note?: string,extra: PageOptions={}): Answer=>({status,body:beliefPage(screen,{...options,...extra,note:note??extra.note}),headers:pageHeaders});
  const redirect=(location: string,cookie?: string): Answer=>({status:303,body:'',headers:{...pageHeaders,location,...(cookie?{'set-cookie':cookie}:{})}});
  if (req.method==='POST' && crossSite(req)) return page('landing',403,'This request could not be verified.');
  if (req.method==='GET' && url.pathname==='/beliefs') return page('landing');
  if (req.method==='GET' && url.pathname==='/beliefs/about') return {status:200,body:aboutPage(options),headers:pageHeaders};
  const accessing=url.pathname==='/beliefs/access';
  if (url.pathname==='/beliefs/join' || accessing) {
    if(req.method==='GET')return page('join',200,undefined,{access:accessing});
    if(req.method!=='POST')return page('join',405);
    if(!accessing && !ready)return page('landing',503,'Paid enrollment is not open yet.');
    if(!sends.take(client,+now))return page('join',429,'Please wait before requesting another code.');
    const form=await readForm(req);const phone=readPhone(form.get('phone')??'');
    if(!phone)return page('join',400,'Check your phone number.',{access:accessing});
    if(!smsConfigured())return page('join',503,'Verification messages are unavailable. Please try later.',{access:accessing});
    const hash=phoneKey(phone);let messageId: string|undefined;
    let challenge: {id:string;code:string}|undefined;
    if(accessing) {
      challenge=await new AccessCodes(deps.store.raw).start(hash,now,async(tx,id,code)=>{
        const [caller]=await tx`select phone_hash from callers where phone_hash=${hash} for update`;
        if(caller)messageId=await enqueue(tx,{eventKey:`beliefs:access:${id}`,phoneHash:hash,channel:'sms',kind:'access',reference:id,to:phone,body:`Your 8&80 Beliefs code is ${code}. It expires in ${TTL_MS/60000} minutes.`},now);
      });
    } else {
      if(form.get('consent')!=='yes')return page('join',400,'Read the service information and confirm your choice.');
      const email=(form.get('email')??'').trim();
      if(email && (email.length>254 || !EMAIL.test(email)))return page('join',400,'Check your email address.');
      const [recent]=await deps.store.raw`select count(*)::int as count from message_outbox where phone_hash=${hash} and kind='signup' and created_at>${new Date(+now-3600_000)}`;
      if(Number(recent?.['count'])>=3)return page('join',429,'Please wait before requesting another code.');
      challenge=await new Pending(deps.store.raw).begin({phone,email,name:(form.get('name')??'').trim().slice(0,80),weekday:0,minute:480,timezone:'Europe/Oslo'},now,async(tx,id,code)=>{
        messageId=await enqueue(tx,{eventKey:`beliefs:signup:${id}`,phoneHash:hash,channel:'sms',kind:'signup',reference:id,to:phone,body:`Your 8&80 Beliefs code is ${code}. It expires in ${TTL_MS/60000} minutes.`},now);
      },'beliefs');
    }
    if(!challenge)return page('join',429,'Please wait before requesting another code.',{access:accessing});
    if(messageId && await dispatchMessage(deps,messageId,now)!=='accepted')return page('join',503,'Your code has not been confirmed as sent. Please try again later.',{access:accessing});
    return page('verify',200,undefined,{challenge:challenge.id,phone,access:accessing});
  }
  if(url.pathname==='/beliefs/verify') {
    if(req.method!=='POST')return redirect('/beliefs/access');
    if(!verifies.take(client,+now))return page('join',429,'Please wait before trying another code.',{access:true});
    const form=await readForm(req);const id=form.get('challenge')??'';const code=form.get('code')??'';const phone=readPhone(form.get('phone')??'');
    let token: string|undefined;
    if(form.get('access')==='yes') {
      const hash=await new AccessCodes(deps.store.raw).verify(id,code,now);
      if(hash)token=await deps.store.raw.begin(async tx=>{
        const [caller]=await tx`select phone_hash from callers where phone_hash=${hash} for update`;
        return caller ? new Links(tx).mint(hash,now,'beliefs') : undefined;
      });
    } else if(phone && ready) {
      await new Pending(deps.store.raw).verify(phone,code,now,id,async(tx,signup)=>{
        const hash=phoneKey(signup.phone);
        await tx`insert into callers(phone_hash,phone_enc,name,email_enc,language) values(${hash},${encrypt(signup.phone)},${signup.name},${signup.email?encrypt(signup.email):null},'en') on conflict do nothing`;
        await new BeliefRepository(tx).enroll(hash,now,{name:signup.name,email:signup.email});
        token=await new Links(tx).mint(hash,now,'beliefs');
      },'beliefs');
    }
    if(!token)return page('verify',400,'The code is incorrect or expired.',{challenge:id,phone,access:form.get('access')==='yes'});
    return redirect('/beliefs/account',practiceCookie(token));
  }
  const token=cookieOf(req,'beliefs');
  const opened=token?await new Links(deps.store.raw).open(token,now,'beliefs'):undefined;
  if(!opened?.ok)return redirect('/beliefs/access',practiceCookie(''));
  const hash=opened.claims.phoneHash;
  const submitted=req.method==='POST'?await readForm(req):undefined;
  const programmeId=submitted?.get('programme')||url.searchParams.get('programme')||undefined;
  const repo=new BeliefRepository(deps.store.raw,programmeId);
  const policies=new ProgrammePolicies(deps.store.raw);
  const loaded=await repo.load(hash);
  if(!loaded)return page('landing',200,'No Beliefs enrollment is attached to this account.');
  const {enrollment:e,practice:p}=loaded;
  const [identity]=await deps.store.raw`select held_for_review,all_calls_stopped from callers where phone_hash=${hash}`;
  const upcoming=nextPracticeAppointment(p,{daily:e.next_daily_at,weekly:e.next_weekly_at,onboarding:e.onboarding_at,checkin:e.checkin_at},now);
  const next=upcoming?.at;
  const programmes=await deps.store.raw<{id:string;is_current:boolean;history_deleted_at:Date|null}[]>`select id,is_current,history_deleted_at from belief_enrollments where phone_hash=${hash} order by created_at desc`;
  const [refund]=await deps.store.raw`select status,guaranteed from belief_refund_requests where programme_id=${e.id}`;
  const [checkinAttempt]=e.checkin_attempt_id?await deps.store.raw`select status from call_attempts where id=${e.checkin_attempt_id}`:[];
  const privateOptions: PageOptions={...options,programmeId:e.id,currentProgramme:e.is_current,programmes,completedAt:e.completed_at?.toISOString(),historyDeleteAt:e.history_delete_at?.toISOString(),historyDeleted:!!e.history_deleted_at,checkinUsed:!!e.checkin_used_at,checkinPending:!!e.checkin_attempt_id && (!checkinAttempt || ['claimed','placed','settling','failed'].includes(checkinAttempt['status'])),refundStatus:refund?.['status'],refundEligible:guaranteedRefund(e,now),refundDeadline:refundDeadline(e.first_connected_at)?.toISOString(),hasPurchase:!!e.purchase_id,practice:p,csrf:csrfFor(token!),paid:e.standing==='active',checkout:e.purchase_id?'':beliefCheckout(e.checkout_reference),held:!!(identity?.['held_for_review']||identity?.['all_calls_stopped']),paymentHold:['payment_hold','refund_requested'].includes(e.standing),
    timezone:e.timezone,daily:e.daily_minute!==null?clock(e.daily_minute):undefined,weekly:e.weekly_minute!==null?clock(e.weekly_minute):undefined,weekday:e.weekly_weekday??undefined,
    next:e.standing==='active' && !identity?.['held_for_review'] && !identity?.['all_calls_stopped'] && p.state!=='paused' && next?describeAppointment(next,e.timezone):undefined,
    nextAt:next?.toISOString(),nextKind:upcoming?.kind,onboardingAt:e.onboarding_at?.toISOString(),selectedId:url.searchParams.get('id')??undefined};
  const savedNotes:Record<string,string>={refund:'Your request is saved for human review. No refund has been issued yet. Contact support for updates.',schedule:'Your usual times are saved.',occurrence:'This call has moved. Your usual times stay the same.',skip:'This call is skipped. No catch-up call will be added.',pause:'Your Beliefs calls are paused.',resume:'Your practice is resumed. Shared STOP or safety holds still apply.'};
  if(url.searchParams.get('saved'))privateOptions.note=savedNotes[url.searchParams.get('saved')!];
  if(req.method==='POST') {
    const form=submitted!;
    if(form.get('csrf')!==csrfFor(token!))return page('account',403,'Open your practice again before saving.',privateOptions);
    if(url.pathname!=='/beliefs/action')return page('account',404,'Page not found.',privateOptions);
    try {
      const action=form.get('action');
      if(!form.get('programme') || form.get('programme')!==e.id)throw new PracticeError('page_changed');
      if(action==='new_programme'){const id=await policies.newProgramme(hash,e.id,form.get('outcome')??'',form.get('confirmed')==='yes',now);return redirect('/beliefs/account?programme='+encodeURIComponent(id));}
      if(action==='refund'){await policies.requestRefund(hash,e.id,form.get('reason')??'',deps,now);return redirect('/beliefs/account?programme='+encodeURIComponent(e.id)+'&saved=refund');}
      if(action==='book_checkin'){await policies.bookCheckin(hash,e.id,form,now);return redirect('/beliefs/account?programme='+encodeURIComponent(e.id));}
      if(action==='cancel_checkin'){await policies.cancelCheckin(hash,e.id);return redirect('/beliefs/account?programme='+encodeURIComponent(e.id));}
      if(action==='extend_history'){await policies.extendHistory(hash,e.id,form.get('until')??'',now);return redirect('/beliefs/account?programme='+encodeURIComponent(e.id));}
      if(action==='acknowledge_retention'){await policies.acknowledgeRetention(hash,e.id,now);return redirect('/beliefs/account?programme='+encodeURIComponent(e.id));}
      if(action==='delete_history'){await policies.deleteHistory(hash,e.id,form.get('confirmation')??'',now);return redirect('/beliefs/account?programme='+encodeURIComponent(e.id));}
      if(action==='signout') {await deps.store.raw`delete from links where code=${token!} and purpose='beliefs'`;return redirect('/beliefs',practiceCookie(''));}
      if(action==='export') {
        const phone=await deps.store.phoneFor(hash);
        const exported=phone?await composeExport(deps.store,phone,deps.script,{includeBeliefs:true}):undefined;
        if(!exported)throw new PracticeError('enrollment_unknown');
        return {status:200,body:exported.body,headers:{'content-type':'text/plain; charset=utf-8','content-disposition':'attachment; filename="8and80-data.txt"','cache-control':'no-store','referrer-policy':'no-referrer'}};
      }
      if(action==='delete') {
        if(form.get('confirmation')!=='DELETE')throw new PracticeError('deletion_confirmation_required');
        const phone=await deps.store.phoneFor(hash);
        if(phone)await deleteAccount(deps,phone,hash);
        return redirect('/beliefs',practiceCookie(''));
      }
      if(action==='schedule') {
        const times=scheduleInput(form,now,!p.understood);
        const checks=times.at?[times.at]:[];let daily=now;let weekly=now;
        for(let day=0;day<35;day++){daily=nextDaily(daily,times.daily,times.timezone);checks.push(daily);}
        for(let week=0;week<6;week++){weekly=nextSlotAfter(weekly,{weekday:times.weekday,minute:times.weekly,timezone:times.timezone});checks.push(weekly);}
        if(checks.some(at=>!withinCoverage(at)))throw new PracticeError('outside_coverage');
        await repo.schedule(hash,form,now);return redirect('/beliefs/account?programme='+encodeURIComponent(e.id)+'&saved=schedule');
      }
      if(action==='occurrence' || action==='skip'){await repo.occurrence(hash,form,now);return redirect('/beliefs/account?programme='+encodeURIComponent(e.id)+'&saved='+action);}
      if(['understood','review'].includes(action??''))throw new PracticeError('review_not_due');
      await repo.command(hash,commandFrom(form),form.get('event')??'',Number(form.get('revision')),now);
      return redirect((action==='outcome'||action==='queue'?'/beliefs/onboarding':action==='prepare'?'/beliefs/prepare':'/beliefs/account')+'?programme='+encodeURIComponent(e.id)+(action==='pause'||action==='resume'?'&saved='+action:''));
    } catch(error) {return page('account',error instanceof PracticeError?409:503,error instanceof PracticeError?messages[error.code]??'Review your choices before continuing.':'This change could not be confirmed. Please try again later.',privateOptions);}
  }
  if(req.method!=='GET')return page('account',405,undefined,privateOptions);
  const screen=url.pathname.slice('/beliefs/'.length);
  if(!['account','schedule','onboarding','prepare'].includes(screen))return page('account',404,'Page not found.',privateOptions);
  return page(screen as Screen,200,undefined,privateOptions);
}
