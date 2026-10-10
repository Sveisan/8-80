import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { cookieOf, crossSite } from '../link/cookie.ts';
import { readPhone } from '../signup/form.ts';
import { emptyPractice, applyCommand, PracticeError, type Practice } from './model.ts';
import { beliefPage, aboutPage, type Screen, type PageOptions } from './page.ts';
import { commandFrom, messages } from './forms.ts';
import { describeAppointment } from '../schedule/time.ts';
import { clock } from './page.ts';
import { scheduleInput, nextDaily } from './repository.ts';
import { csrfFor, practiceCookie, readForm, pageHeaders } from './http.ts';

interface PreviewSession { at: number; verified: boolean; paid: boolean; practice: Practice; week: number; scheduled: boolean; schedule?: ReturnType<typeof scheduleInput>; }
/** Ephemeral, loopback-only rehearsal. No provider, credentials, database or personal seed data. */
export function previewServer(): Server {
  const sessions = new Map<string,PreviewSession>();
  return createServer((req,res) => { void (async () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health') { res.writeHead(200,{'content-type':'application/json'}); res.end('{"ok":true,"preview":true}'); return; }
    if (url.pathname === '/') { res.writeHead(303,{location:'/beliefs'}); res.end(); return; }
    for (const [id,s] of sessions) if (Date.now()-s.at > 3600_000) sessions.delete(id);
    let token = cookieOf(req,'beliefs') ?? '';
    if (!sessions.has(token)) { token=randomUUID();sessions.set(token,{at:Date.now(),verified:false,paid:false,practice:emptyPractice(),week:0,scheduled:false}); }
    const s = sessions.get(token)!;
    const options: PageOptions = {preview:true,available:true,practice:s.practice,csrf:csrfFor(token),paid:s.paid,week:s.week,price:"Same as one month of 8&80",timezone:s.schedule?.timezone,daily:s.schedule?clock(s.schedule.daily):undefined,weekly:s.schedule?clock(s.schedule.weekly):undefined,weekday:s.schedule?.weekday,next:s.schedule && !['paused','completed'].includes(s.practice.state)?describeAppointment(s.practice.understood?nextDaily(new Date(),s.schedule.daily,s.schedule.timezone):s.schedule.at,s.schedule.timezone):undefined};
    const send = (screen: Screen, status=200, note?: string): void => { res.writeHead(status,{...pageHeaders,'set-cookie':practiceCookie(token,true)});res.end(beliefPage(screen,{...options,note})); };
    const redirect = (to: string): void => {res.writeHead(303,{location:to,'cache-control':'no-store','set-cookie':practiceCookie(token,true)});res.end();};
    if (url.pathname === '/beliefs/about' || url.pathname === '/terms' || url.pathname === '/privacy') {res.writeHead(200,pageHeaders);res.end(aboutPage(options));return;}
    if (req.method === 'POST') {
      if (crossSite(req)) return send('landing',403,'This request could not be verified.');
      const form = await readForm(req);
      if (form.get('csrf') !== csrfFor(token)) return send('landing',403,'Open the page again before continuing.');
      if (url.pathname === '/beliefs/join' || url.pathname === '/beliefs/access') {
        if (!readPhone(form.get('phone') ?? '')) return send('join',400,'Check your phone number.');
        if (url.pathname === '/beliefs/join' && form.get('consent') !== 'yes') return send('join',400,'Read the service information and confirm your choice.');
        return send('verify');
      }
      if (url.pathname === '/beliefs/verify') {
        if (form.get('code') !== '000000') return send('verify',400,'For this preview, use 000000.');
        s.verified=true;return redirect('/beliefs/schedule');
      }
      if (!s.verified) return redirect('/beliefs/join');
      if (url.pathname !== '/beliefs/action') return send('account',404,'Page not found.');
      const action = form.get('action');
      try {
        if (action === 'signout') {sessions.delete(token);res.writeHead(303,{location:'/beliefs','set-cookie':practiceCookie('',true)});res.end();return;}
        if (action === 'schedule') {s.schedule=scheduleInput(form);s.scheduled=true;return redirect('/beliefs/account');}
        if (action === 'pay') {s.paid=true;return redirect('/beliefs/account');}
        if (action === 'nextweek') {s.week++;return redirect('/beliefs/weekly');}
        if (['practice','review','understood'].includes(action??'') && (!s.paid || !s.scheduled)) return send('account',409,'Choose your times and preview payment confirmation first.');
        if (Number(form.get('revision'))!==s.practice.revision) throw new PracticeError('page_changed');
        s.practice=applyCommand(s.practice,commandFrom(form,s.week),form.get('event')??'');
        return redirect(action === 'outcome' || action === 'queue' ? '/beliefs/onboarding' : action === 'prepare' ? '/beliefs/prepare' : '/beliefs/account');
      } catch(e) {return send('account',400,e instanceof PracticeError ? messages[e.code]??'Review your choices and try again.' : 'Check your choices and try again.');}
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send('landing',405,'Method not allowed.');
    if (url.pathname === '/beliefs') return send('landing');
    if (url.pathname === '/beliefs/join' || url.pathname === '/beliefs/access') return send('join');
    if (!s.verified) return redirect('/beliefs/join');
    const screen = url.pathname.slice('/beliefs/'.length);
    if (!['schedule','onboarding','prepare','account','daily','weekly'].includes(screen)) return send('account',404,'Page not found.');
    if (screen === 'account') {
      res.writeHead(200,{...pageHeaders,'set-cookie':practiceCookie(token,true)});
      const extra = s.practice.understood ? `<section class="account"><details><summary>Preview controls</summary><p class="quiet">Move forward one week to explore reassessment and retirement. This changes only this local preview.</p><form method="post" action="/beliefs/action"><input type="hidden" name="csrf" value="${csrfFor(token)}"><input type="hidden" name="action" value="nextweek"><button>Advance preview by one week</button></form></details></section>` : '';
      res.end(beliefPage('account',options).replace('</main>',`${extra}</main>`));return;
    }
    return send(screen as Screen);
  })().catch(() => {if (!res.headersSent) res.writeHead(500,pageHeaders);res.end('The preview could not complete this request. Reload and try again.');}); });
}
