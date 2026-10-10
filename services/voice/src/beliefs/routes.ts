import type { IncomingMessage } from 'node:http';
import { config, smsConfigured } from '../config.ts';
import type { LoopDeps } from '../loop/deps.ts';
import type { Answer } from '../signup/routes.ts';
import { Pending } from '../signup/pending.ts';
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
import { beliefCheckout } from './billing.ts';
import { commandFrom, messages } from './forms.ts';
import { PracticeError } from './model.ts';

const sends=new Limiter(8,3600_000);const verifies=new Limiter(30,600_000);
export async function beliefRoutes(req: IncomingMessage,url: URL,deps: LoopDeps,client: string,now=new Date()): Promise<Answer | undefined> {
  if (url.pathname !== '/beliefs' && !url.pathname.startsWith('/beliefs/')) return undefined;
  const c=beliefConfig();
  const ready=beliefReadiness().length===0;
  const options: PageOptions={available:ready,price:c.price,support:config.company.supportEmail()?`mailto:${config.company.supportEmail()}`:undefined,supportHours:c.supportHours};
  const page=(screen: Screen,status=200,note?: string,extra: PageOptions={}): Answer=>({status,body:beliefPage(screen,{...options,...extra,note}),headers:pageHeaders});
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
        if(caller)messageId=await enqueue(tx,{eventKey:`beliefs:access:${id}`,phoneHash:hash,channel:'sms',kind:'access',reference:id,to:phone,body:`Your 8&80 verification code is ${code}. It expires in ten minutes.`},now);
      });
    } else {
      if(form.get('consent')!=='yes')return page('join',400,'Read the service information and confirm your choice.');
      const email=(form.get('email')??'').trim();
      if(email && !EMAIL.test(email))return page('join',400,'Check your email address.');
      const [recent]=await deps.store.raw`select count(*)::int as count from message_outbox where phone_hash=${hash} and kind='signup' and created_at>${new Date(+now-3600_000)}`;
      if(Number(recent?.['count'])>=3)return page('join',429,'Please wait before requesting another code.');
      challenge=await new Pending(deps.store.raw).begin({phone,email,name:(form.get('name')??'').trim().slice(0,80),weekday:0,minute:480,timezone:'Europe/Oslo'},now,async(tx,id,code)=>{
        messageId=await enqueue(tx,{eventKey:`beliefs:signup:${id}`,phoneHash:hash,channel:'sms',kind:'signup',reference:id,to:phone,body:`Your 8&80 verification code is ${code}. It expires in ten minutes.`},now);
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
        await new BeliefRepository(tx).enroll(hash,now);
        token=await new Links(tx).mint(hash,now,'beliefs');
      },'beliefs');
    }
    if(!token)return page('verify',400,'The code is incorrect or expired.',{challenge:id,phone,access:form.get('access')==='yes'});
    return redirect('/beliefs/account',practiceCookie(token));
  }
  const token=cookieOf(req,'beliefs');
  const opened=token?await new Links(deps.store.raw).open(token,now,'beliefs'):undefined;
  if(!opened?.ok)return redirect('/beliefs/access',practiceCookie(''));
  const hash=opened.claims.phoneHash;const repo=new BeliefRepository(deps.store.raw);
  const loaded=await repo.load(hash);
  if(!loaded)return page('landing',200,'No Beliefs enrollment is attached to this account.');
  const {enrollment:e,practice:p}=loaded;
  const [identity]=await deps.store.raw`select held_for_review,all_calls_stopped from callers where phone_hash=${hash}`;
  const next=p.understood?[e.next_daily_at,e.next_weekly_at].filter((at):at is Date=>!!at).sort((a,b)=>+a-+b)[0]:e.onboarding_at;
  const privateOptions: PageOptions={...options,practice:p,csrf:csrfFor(token!),paid:e.standing==='active',checkout:e.purchase_id?'':beliefCheckout(hash),held:!!(identity?.['held_for_review']||identity?.['all_calls_stopped']),paymentHold:e.standing==='payment_hold',
    timezone:e.timezone,daily:e.daily_minute!==null?clock(e.daily_minute):undefined,weekly:e.weekly_minute!==null?clock(e.weekly_minute):undefined,weekday:e.weekly_weekday??undefined,
    next:e.standing==='active' && !identity?.['held_for_review'] && !identity?.['all_calls_stopped'] && !['paused','completed'].includes(p.state) && next && next>now?describeAppointment(next,e.timezone):undefined};
  if(req.method==='POST') {
    const form=await readForm(req);
    if(form.get('csrf')!==csrfFor(token!))return page('account',403,'Open your practice again before saving.',privateOptions);
    if(url.pathname!=='/beliefs/action')return page('account',404,'Page not found.',privateOptions);
    try {
      const action=form.get('action');
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
        const times=scheduleInput(form,now);
        const checks=[times.at];let daily=now;let weekly=now;
        for(let day=0;day<35;day++){daily=nextDaily(daily,times.daily,times.timezone);checks.push(daily);}
        for(let week=0;week<6;week++){weekly=nextSlotAfter(weekly,{weekday:times.weekday,minute:times.weekly,timezone:times.timezone});checks.push(weekly);}
        if(checks.some(at=>!withinCoverage(at)))throw new PracticeError('outside_coverage');
        await repo.schedule(hash,form,now);return redirect('/beliefs/account');
      }
      if(['understood','review'].includes(action??''))throw new PracticeError('review_not_due');
      await repo.command(hash,commandFrom(form),form.get('event')??'',Number(form.get('revision')),now);
      return redirect(action==='outcome'||action==='queue'?'/beliefs/onboarding':action==='prepare'?'/beliefs/prepare':'/beliefs/account');
    } catch(error) {return page('account',error instanceof PracticeError?409:503,error instanceof PracticeError?messages[error.code]??'Review your choices before continuing.':'This change could not be confirmed. Please try again later.',privateOptions);}
  }
  if(req.method!=='GET')return page('account',405,undefined,privateOptions);
  const screen=url.pathname.slice('/beliefs/'.length);
  if(!['account','schedule','onboarding','prepare'].includes(screen))return page('account',404,'Page not found.',privateOptions);
  return page(screen as Screen,200,undefined,privateOptions);
}
