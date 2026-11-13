import { createServer } from 'node:http';
import { designGuide } from '../services/voice/src/design-system/guide.ts';
import { serveDesignAsset } from '../services/voice/src/design-system/assets.ts';
import { loadScript } from '../services/voice/src/script.ts';
import { signupPage, codePage } from '../services/voice/src/signup/page.ts';
import { reschedulePage, confirmStopPage, stoppedPage, gonePage } from '../services/voice/src/link/page.ts';
import { accessPage, accessCodePage } from '../services/voice/src/access/page.ts';
import { memoryPage } from '../services/voice/src/memory/page.ts';
import { feedbackPage, feedbackThanksPage } from '../services/voice/src/feedback/page.ts';
import { legalPage } from '../services/voice/src/legal/page.ts';
import { beliefPage, aboutPage, type Screen } from '../services/voice/src/beliefs/page.ts';
import { emptyPractice } from '../services/voice/src/beliefs/model.ts';
import { unblockPage, aboutPage as unblockAboutPage, type Screen as UnblockScreen } from '../services/voice/src/unblock/page.ts';
import { emptyProgramme } from '../services/voice/src/unblock/model.ts';
import { pageHeaders as unblockHeaders } from '../services/voice/src/unblock/http.ts';
import { pageHeaders } from '../services/voice/src/beliefs/http.ts';
import { describeAppointment, nextSlotAfter } from '../services/voice/src/schedule/time.ts';
import { readBookingSlot } from '../services/voice/src/signup/form.ts';

if (process.argv.includes('--build')) {
  const { build } = await import('./design/build.ts');
  build();
} else {
  const script = loadScript();
  const now = process.env['DESIGN_TEST_TIME'] ? new Date(process.env['DESIGN_TEST_TIME']!) : new Date();
  const slot = { weekday: 4, minute: 17 * 60 + 30, timezone: 'Europe/Oslo' };
  const next = nextSlotAfter(now, slot);
  const practice = { ...emptyPractice(), outcome: 'Make room for the things I care about.', understood: true, state: 'active' as const };
  practice.beliefs = [{
    id: 'synthetic-belief', version: 1, status: 'active', confirmed: true,
    belief: 'I need to finish everything before I can take an evening off.',
    trigger: 'When work is still open at the end of the day.',
    decision: 'I can leave room for one evening without plans.',
    evidence: [{ text: 'I left work on time on Thursday, and the next morning was still manageable.', at: now.toISOString() }],
    balance: 'Some deadlines do need extra attention.', opportunity: 'I can choose one evening each week.', reviews: [],
  }];
  const programme = { ...emptyProgramme(), openingHeld: true,
    wishes: [{ version: 1, text: 'Make room for the people and places I care about.', why: 'I miss having unhurried evenings.', at: now.toISOString() }],
    ledger: [{ id: 'synthetic-moment', week: 1, occurredOn: '2026-11-05', text: 'A walk with an old friend, without checking the time.', source: 'light_call' as const, at: now.toISOString() }],
  };
  const pages: Record<string, () => string> = {
    '/': () => designGuide(true), '/design-system': () => designGuide(true),
    '/beliefs/about': () => aboutPage({ preview: true }),
    '/start': () => signupPage(script, {}, 'en', now),
    '/start/error': () => signupPage(script, { errors: [{ field: 'email', why: 'email' }], values: { name: 'Alex', email: 'alex@' } }, 'en', now),
    '/start/code': () => codePage('+47 900 00 000', script),
    '/access': () => accessPage(script),
    '/access/code': () => accessCodePage(script, 'synthetic', '+47 900 00 000'),
    '/me': () => reschedulePage(slot, script, 'en', 'alex@example.com', undefined, { next, contact: true, goals: true, account: { billing: 'active', canCall: true, paused: false } }),
    '/me/paused': () => reschedulePage(slot, script, 'en', undefined, undefined, { account: { billing: 'active', canCall: true, paused: true } }),
    '/me/stop': () => confirmStopPage(script),
    '/me/stopped': () => stoppedPage(script),
    '/me/expired': () => gonePage(script),
    '/memory': () => memoryPage({ revision: 'synthetic', commitment: 'Make room for one evening without plans.', goals: 'Spend more time outside.\nStay in touch with old friends.' }, script),
    '/feedback': () => feedbackPage(script, { pickup: '', nearly: '', else: '' }),
    '/feedback/thanks': () => feedbackThanksPage(script),
    '/privacy': () => legalPage('privacy'), '/terms': () => legalPage('terms'),
  };
  for (const screen of ['landing', 'join', 'verify', 'schedule', 'account'] satisfies UnblockScreen[]) {
    pages[screen === 'landing' ? '/unblock' : `/unblock/${screen}`] = () => unblockPage(screen, {
      preview: true, available: true, programme, paid: true, scheduled: true, timezone: slot.timezone,
      weekly: '17:30', weekday: slot.weekday, lightDays: [1, 3, 5], lightTime: '19:00', openingAt: next.toISOString(),
      next: { at: next.toISOString(), text: describeAppointment(next, slot.timezone), kind: 'call', label: 'Regular call', moveable: true, weekly: true },
      sub: { standing: 'active', cancelling: false, callsPerMonth: 4, manageable: true, timezone: slot.timezone },
    });
  }
  pages['/unblock/about'] = () => unblockAboutPage({ preview: true });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
      res.end('Read-only design preview. No changes, calls, texts or payments are made.'); return;
    }
    if (serveDesignAsset(url.pathname, res, req.method === 'HEAD')) return;
    if (url.pathname === '/start/appointment') {
      const choice = readBookingSlot(url.searchParams, now);
      const when = choice.ok ? describeAppointment(nextSlotAfter(now, choice.slot), choice.slot.timezone) : '';
      res.writeHead(choice.ok ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ when })); return;
    }
    const beliefScreen = url.pathname === '/beliefs' ? 'landing' : url.pathname.slice('/beliefs/'.length);
    const isBelief = url.pathname === '/beliefs' || url.pathname.startsWith('/beliefs/');
    const supported = ['landing','join','verify','schedule','onboarding','prepare','account','daily','weekly'];
    let page = isBelief && supported.includes(beliefScreen)
      ? beliefPage(beliefScreen as Screen, { preview: true, available: true, paid: true, practice, next: describeAppointment(next, slot.timezone), nextAt: next.toISOString(), nextKind: 'weekly', timezone: slot.timezone })
      : pages[url.pathname]?.();
    const theme = url.searchParams.get('theme');
    if (page && (theme === 'light' || theme === 'dark')) {
      page = page.replace(/<html([^>]*)>/, (_, attributes: string) => `<html${attributes.replace(/ data-theme="[^"]*"/, '')} data-theme="${theme}">`);
    }
    res.writeHead(page ? 200 : 404, url.pathname.startsWith('/unblock') ? unblockHeaders : isBelief ? pageHeaders : { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : page ?? '<p>Preview not found. <a href="/">Open the handbook</a></p>');
  });
  const port = Number(process.env['DESIGN_PREVIEW_PORT'] ?? 8780);
  server.listen(port, '127.0.0.1', () => console.log(`8&80 design system: http://127.0.0.1:${port} · product previews: /start, /me, /memory, /feedback, /beliefs, /unblock`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
}
