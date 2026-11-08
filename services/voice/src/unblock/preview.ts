import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { cookieOf, crossSite } from '../link/cookie.ts';
import { readPhone } from '../signup/form.ts';
import { describeAppointment, nextSlotAfter } from '../schedule/time.ts';
import { PracticeError } from '../beliefs/model.ts';
import { escape } from '../beliefs/page.ts';
import { appointmentInput } from '../beliefs/repository.ts';
import { applyCommand, emptyProgramme, finishCall, firstWeekly, localDay, nextLight, selectLedgerReadback, type Command, type Programme, type Schedule } from './model.ts';
import { scheduleInput } from './repository.ts';
import { unblockPage, aboutPage, clock, type NextCall, type PageOptions, type Screen } from './page.ts';
import { csrfFor, unblockCookie, readForm, pageHeaders } from './http.ts';
import { messages, normaliseSchedule } from './forms.ts';

interface PreviewSession {
  at: number; verified: boolean; paid: boolean; programme: Programme;
  schedule?: ReturnType<typeof scheduleInput>; nextCall?: Date; nextLight?: Date;
  /** Simulated calendar: each simulated regular call moves it a week on, each light call a day, so the ledger spans dates. */
  virtual: Date; note?: string;
}
const SYNTHETIC = {
  wish: 'Synthetic wish: learn to sail a small boat', why: 'Synthetic reason: the water is where I feel most myself',
  revised: 'Synthetic wish, reworded: spend one weekend a month on the water',
  blocks: [['Synthetic block: I would have to spend money I do not have', 'limit'], ['Synthetic block: people would think it is silly at my age', 'prediction'], ['Synthetic block: not sure what exactly is stopping me', 'unsure']] as const,
  steps: ['Synthetic step: ask one person about a sailing course', 'Synthetic step: visit the harbour on a Saturday', 'Synthetic step: book a single taster lesson', 'Synthetic step: sail for one hour'],
  outcomes: [['done', 'Synthetic outcome: I asked my neighbour'], ['partly', 'Synthetic outcome: I went but did not stay'], ['not', 'Synthetic outcome: a busy week'], ['changed', 'Synthetic outcome: I booked a lesson instead']] as const,
  light: ['Synthetic moment: the light on the kitchen wall at breakfast', 'Synthetic moment: a stranger held the door and smiled', 'Synthetic moment: ten quiet minutes with tea', 'Synthetic moment: my daughter laughing on the phone', 'Synthetic moment: the smell of rain on warm stone', 'Synthetic moment: finishing a hard email early', 'Synthetic moment: a song I had forgotten'],
  closing: 'Synthetic closing: I want to keep both the wish and the mornings', carry: 'Synthetic carry: look up before looking ahead',
};
const WEEK_MS = 7 * 86400_000;

/** Ephemeral, loopback-only rehearsal. No provider, credentials, database or personal seed data. */
export function previewServer(): Server {
  const sessions = new Map<string, PreviewSession>();
  return createServer((req, res) => { void (async () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"preview":true}'); return; }
    if (url.pathname === '/') { res.writeHead(303, { location: '/unblock' }); res.end(); return; }
    for (const [id, s] of sessions) if (Date.now() - s.at > 3600_000) sessions.delete(id);
    const cookieName = 'unblock_preview_' + req.socket.localPort;
    const cookie = (value: string): string => unblockCookie(value, true).replace('unblock=', cookieName + '=');
    let token = cookieOf(req, cookieName) ?? '';
    if (!sessions.has(token)) { token = randomUUID(); sessions.set(token, { at: Date.now(), verified: false, paid: false, programme: emptyProgramme(), virtual: new Date() }); }
    const s = sessions.get(token)!;
    const submitted = req.method === 'POST' ? await readForm(req) : undefined;
    const tz = s.schedule?.timezone ?? 'Europe/Oslo';
    const slot = (): Schedule => ({ timezone: tz, weeklyWeekday: s.schedule?.weekday ?? null, weeklyMinute: s.schedule?.weekly ?? null, lightWeekdays: s.schedule?.lightDays ?? [], lightMinute: s.schedule?.lightMinute ?? null });
    const callCard = (): NextCall | undefined => s.nextCall && s.programme.state === 'active' && s.paid ? { at: s.nextCall.toISOString(), text: describeAppointment(s.nextCall, tz), kind: 'call', label: s.programme.openingHeld ? 'Regular call' : 'Opening conversation', moveable: true, weekly: s.programme.openingHeld } : undefined;
    const lightCard = (): NextCall | undefined => s.nextLight && s.programme.state === 'active' && s.paid ? { at: s.nextLight.toISOString(), text: describeAppointment(s.nextLight, tz), kind: 'light', label: 'Light call', moveable: false, weekly: false } : undefined;
    const readback = selectLedgerReadback(s.programme.ledger);
    const controls = (): string => {
      const post = (action: string, label: string): string => `<form method="post" action="/unblock/action"><input type="hidden" name="csrf" value="${csrfFor(token)}"><input type="hidden" name="action" value="${action}"><button type="submit">${label}</button></form>`;
      const done = s.programme.state === 'completed';
      return `<details class="spaced" data-preview-controls><summary>Preview controls</summary><p class="quiet">These move only this local preview forward. They do not exist in production.</p>
        ${s.paid && s.schedule && !done ? `${post('sim_call', s.programme.openingHeld ? 'Simulate the next regular call being held' : 'Simulate the opening call being held')}${s.programme.openingHeld ? post('sim_light', 'Simulate a light call') : ''}${post('sim_missed', 'Simulate a missed call')}` : '<p class="quiet">Choose your times and preview payment confirmation first.</p>'}
        ${s.programme.weeksHeld >= 3 && !done ? `<p class="quiet">In the last conversation of the chapter, these entries would be read back in your own words (at most five, chosen by recency and spread, never by content):</p><ul>${readback.map(e => `<li>${escape(e.text)}</li>`).join('') || '<li class="quiet">No moments saved yet. Simulate a few light calls.</li>'}</ul>` : ''}</details>`;
    };
    const options = (): PageOptions => ({ preview: true, available: true, programme: s.programme, csrf: csrfFor(token), paid: s.paid, scheduled: !!s.schedule,
      price: undefined, timezone: tz, weekly: s.schedule ? clock(s.schedule.weekly) : undefined, weekday: s.schedule?.weekday, lightDays: s.schedule?.lightDays, lightTime: s.schedule?.lightMinute != null ? clock(s.schedule.lightMinute) : undefined,
      openingAt: !s.programme.openingHeld ? s.nextCall?.toISOString() : undefined, next: callCard(), nextLight: lightCard(), siblingHref: '/beliefs', controls: controls() });
    const send = (screen: Screen, status = 200, note?: string): void => { res.writeHead(status, { ...pageHeaders, 'set-cookie': cookie(token) }); res.end(unblockPage(screen, { ...options(), note: note ?? s.note })); s.note = undefined; };
    const redirect = (to: string): void => { res.writeHead(303, { location: to, 'cache-control': 'no-store', 'set-cookie': cookie(token) }); res.end(); };
    if (url.pathname === '/unblock/about' || url.pathname === '/terms' || url.pathname === '/privacy') { res.writeHead(200, pageHeaders); res.end(aboutPage(options())); return; }
    if (url.pathname === '/beliefs') { res.writeHead(200, pageHeaders); res.end('<!doctype html><title>Beliefs</title><p>Beliefs is a separate practice and is not part of this Unblock preview.</p>'); return; }
    const event = (): string => 'preview-' + randomUUID();
    const run = (command: Command): void => { s.programme = applyCommand(s.programme, command, event()); };
    if (req.method === 'POST') {
      if (crossSite(req)) return send('landing', 403, 'This request could not be verified.');
      const form = submitted!;
      if (form.get('csrf') !== csrfFor(token)) return send('landing', 403, 'Open the page again before continuing.');
      if (url.pathname === '/unblock/join' || url.pathname === '/unblock/access') {
        if (!readPhone(form.get('phone') ?? '')) return send('join', 400, 'Check your phone number.');
        if (url.pathname === '/unblock/join' && form.get('consent') !== 'yes') return send('join', 400, 'Read the service information and confirm your choice.');
        return send('verify');
      }
      if (url.pathname === '/unblock/verify') {
        if (form.get('code') !== '000000') return send('verify', 400, 'For this preview, use 000000.');
        s.verified = true; return redirect(s.schedule ? '/unblock/account' : '/unblock/schedule');
      }
      if (!s.verified) return redirect('/unblock/join');
      if (url.pathname !== '/unblock/action') return send('account', 404, 'Page not found.');
      const action = form.get('action');
      try {
        if (action === 'signout') { sessions.delete(token); res.writeHead(303, { location: '/unblock', 'set-cookie': cookie('') }); res.end(); return; }
        if (action === 'schedule') {
          const input = scheduleInput(normaliseSchedule(form), new Date());
          s.schedule = input;
          const base = slot();
          s.nextCall = s.programme.openingHeld ? nextSlotAfter(new Date(), { weekday: input.weekday, minute: input.weekly, timezone: input.timezone }) : input.opening ?? firstWeekly(new Date(), base) ?? undefined;
          s.nextLight = s.programme.openingHeld && input.lightMinute !== null ? nextLight(new Date(), input.lightDays, input.lightMinute, input.timezone) ?? undefined : undefined;
          return redirect('/unblock/account');
        }
        // The payment seam: the preview flips an in-memory flag where production waits for the provider's authoritative paid state.
        if (action === 'pay') { s.paid = true; return redirect('/unblock/account'); }
        if (action === 'pause' || action === 'resume') { run({ type: action }); return redirect('/unblock/account'); }
        if (action === 'occurrence' || action === 'skip') {
          const light = form.get('kind') === 'light'; const current = light ? s.nextLight : s.nextCall;
          if (!s.paid || !s.schedule || s.programme.state !== 'active') throw new PracticeError('calls_held');
          if (!current || current.toISOString() !== form.get('expected_at')) throw new PracticeError('page_changed');
          const following = light ? nextLight(current, s.schedule.lightDays, s.schedule.lightMinute!, tz) : s.programme.openingHeld ? nextSlotAfter(current, { weekday: s.schedule.weekday, minute: s.schedule.weekly, timezone: tz }) : firstWeekly(current, slot());
          if (action === 'skip') { if (light) s.nextLight = following ?? undefined; else s.nextCall = following ?? undefined; return redirect('/unblock/account'); }
          const at = appointmentInput(form, tz);
          if (s.programme.openingHeld && (at <= current || (following && at >= following))) throw new PracticeError('occurrence_too_late');
          s.nextCall = at; return redirect('/unblock/account');
        }
        if (action === 'sim_missed') { s.note = 'A call was missed. It is not made up later: the same conversation is offered at your next usual time.'; if (s.schedule && s.nextCall) s.nextCall = nextSlotAfter(s.nextCall, { weekday: s.schedule.weekday, minute: s.schedule.weekly, timezone: tz }); return redirect('/unblock/account'); }
        if (action === 'sim_light' || action === 'sim_call') {
          if (!s.paid || !s.schedule) return send('account', 409, 'Choose your times and preview payment confirmation first.');
          const p = () => s.programme;
          if (action === 'sim_light') {
            if (!p().openingHeld || p().state !== 'active') throw new PracticeError('calls_held');
            s.virtual = new Date(+s.virtual + 86400_000);
            run({ type: 'light', text: SYNTHETIC.light[p().ledger.length % SYNTHETIC.light.length]!, occurredOn: localDay(s.virtual, tz), source: 'light_call', week: p().weeksHeld + 1 });
          } else if (!p().openingHeld) {
            run({ type: 'wish', text: SYNTHETIC.wish, why: SYNTHETIC.why });
            run({ type: 'step', week: 1, text: SYNTHETIC.steps[0]! });
            s.programme = finishCall(p(), 'opening', 0);
            s.nextCall = nextSlotAfter(new Date(+Date.now() + 5 * 86400_000), { weekday: s.schedule.weekday, minute: s.schedule.weekly, timezone: tz });
            if (s.schedule.lightMinute !== null) s.nextLight = nextLight(new Date(Date.now() + 12 * 3600_000), s.schedule.lightDays, s.schedule.lightMinute, tz) ?? undefined;
          } else if (p().state === 'active') {
            const week = p().weeksHeld + 1; s.virtual = new Date(+s.virtual + WEEK_MS);
            const [outcome, outcomeText] = SYNTHETIC.outcomes[(week - 1) % 4]!;
            run({ type: 'step_outcome', week, outcome, outcomeText });
            if (week <= 3) run({ type: 'block', text: SYNTHETIC.blocks[week - 1]![0], kind: SYNTHETIC.blocks[week - 1]![1], week });
            if (week === 3) run({ type: 'wish', text: SYNTHETIC.revised, why: '' });
            if (week < 4) run({ type: 'step', week: week + 1, text: SYNTHETIC.steps[week]! });
            // With no light calls, each regular call asks for one moment instead, so the ledger is never empty.
            if (!s.schedule.lightDays.length) run({ type: 'light', text: SYNTHETIC.light[p().ledger.length % SYNTHETIC.light.length]!, occurredOn: localDay(s.virtual, tz), source: 'weekly_call', week });
            if (week === 4) run({ type: 'closing', text: SYNTHETIC.closing, carryText: SYNTHETIC.carry });
            s.programme = finishCall(p(), 'weekly', week);
            if (p().state === 'completed') { s.nextCall = undefined; s.nextLight = undefined; }
            else s.nextCall = nextSlotAfter(new Date(), { weekday: s.schedule.weekday, minute: s.schedule.weekly, timezone: tz });
          }
          return redirect('/unblock/account');
        }
        throw new PracticeError('schedule_invalid');
      } catch (e) { return send('account', 400, e instanceof PracticeError ? messages[e.code] ?? 'Review your choices and try again.' : 'Check your choices and try again.'); }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send('landing', 405, 'Method not allowed.');
    if (url.pathname === '/unblock') return send('landing');
    if (url.pathname === '/unblock/join' || url.pathname === '/unblock/access') return send('join');
    if (!s.verified) return redirect('/unblock/join');
    const screen = url.pathname.slice('/unblock/'.length);
    if (!['schedule', 'account'].includes(screen)) return send('account', 404, 'Page not found.');
    return send(screen as Screen);
  })().catch(() => { if (!res.headersSent) res.writeHead(500, pageHeaders); res.end('The preview could not complete this request. Reload and try again.'); }); });
}
