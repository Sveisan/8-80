import { milestone, countRequest } from '../journey/measure.ts';
import type { IncomingMessage } from 'node:http';
import { config } from '../config.ts';
import { log } from '../log.ts';
import { Links } from '../link/token.ts';
import { phoneKey } from '../store/postgres.ts';
import { enqueue, queued, dispatchMessage } from '../messages/outbox.ts';
import { Scheduler } from '../schedule/scheduler.ts';
import { textBeforeFirstCall } from '../sms/welcome.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { readSignup, type Signup } from './form.ts';
import { Limiter } from './limit.ts';
import { Pending } from './pending.ts';
import { codePage, signupPage, type SignupFormState } from './page.ts';
import { browserCookie, crossSite } from '../link/cookie.ts';

export interface Answer { status: number; body: string; headers?: Record<string, string | string[]>; }
const HOUR = 3600_000;
const perNumber = new Limiter(3, HOUR);
const perClient = new Limiter(10, HOUR);
const resendDelay = new Limiter(1, 60_000);
const verifyClient = new Limiter(30, 10 * 60_000);
const TRIAL_DAYS = 30;

async function body(req: IncomingMessage): Promise<URLSearchParams | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 8192) return undefined;
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

const valuesOf = (signup: Signup): SignupFormState['values'] => ({
  name: signup.name, phone: signup.phone, email: signup.email, weekday: String(signup.weekday),
  time: `${String(Math.floor(signup.minute / 60)).padStart(2, '0')}:${String(signup.minute % 60).padStart(2, '0')}`,
  timezone: signup.timezone,
});

/** Draft capabilities preserve booking choices without revealing them by phone-number lookup. */
export async function signupRoutes(req: IncomingMessage, url: URL, deps: LoopDeps, client: string, now = new Date()): Promise<Answer | undefined> {
  const { script, store } = deps;
  const pending = new Pending(store.raw);
  const page = (status: number, state: SignupFormState = {}): Answer => ({ status, body: signupPage(script, state, 'en', now) });
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/start')) {
    if (!config.signup.open()) return undefined;
    await countRequest(store.raw, 'booking_view', now);
    return page(200);
  }
  if (req.method !== 'POST' || !['/start', '/start/verify', '/start/resend', '/start/edit'].includes(url.pathname)) return undefined;
  if (crossSite(req)) return page(403, { note: 'signup.code.tryagain' });
  if (url.pathname === '/start' && !config.signup.open()) return undefined;
  const form = await body(req);
  if (!form) return page(413, { note: 'signup.code.tryagain' });
  const id = (form.get('draft') ?? '').slice(0, 36);
  const saved = id ? await pending.draft(id, now) : undefined;
  const draft = saved ? { id, signup: saved } : undefined;

  if (url.pathname === '/start/verify') {
    const phone = (form.get('phone') ?? '').trim();
    if (!verifyClient.take(client, +now)) return { status: 429, body: codePage(phone, script, 'signup.code.verifylimited', 'en', draft) };
    let browser = '';
    const messageIds: string[] = [];
    const verdict = await pending.verify(phone, form.get('code') ?? '', now, id || undefined, async (tx, signup) => {
      const hash = phoneKey(signup.phone);
      const scopedStore = store.in(tx);
      // Serialize competing signup/recovery while preserving any existing account.
      await tx`select pg_advisory_xact_lock(hashtextextended(${hash}, 1))`;
      if (!(await scopedStore.phoneFor(hash))) {
        const slot = { weekday: signup.weekday, minute: signup.minute, timezone: signup.timezone };
        await scopedStore.upsertProfile(signup.phone, { ...(signup.name ? { name: signup.name } : {}), email: signup.email });
        await scopedStore.startTrial(signup.phone, new Date(+now + TRIAL_DAYS * 24 * HOUR));
        const first = await new Scheduler(tx).setSlot(signup.phone, slot, now);
        const messages = queued(tx, hash, `welcome:${hash}:${now.toISOString()}`, now, 'welcome');
        const link = `${config.link.publicUrl().replace(/\/$/, '')}/r/${await new Links(tx).mint(hash, now)}`;
        await textBeforeFirstCall(signup.phone, first, slot, { sms: messages.sms, script }, link);
        messageIds.push(...messages.ids);
        await milestone(tx, hash, 'phone_verified', hash, now);
        log('signup.completed', { trialDays: TRIAL_DAYS });
      }
      browser = await new Links(tx).mint(hash, now, 'browser');
    });
    if (!verdict.ok) {
      const key = { unknown: 'signup.code.unknown', expired: 'signup.code.expired', wrong: 'signup.code.wrong', 'too many': 'signup.code.toomany' }[verdict.why];
      return { status: 400, body: codePage(phone, script, key, 'en', draft) };
    }
    let notice = '';
    for (const id of messageIds) if (await dispatchMessage(deps, id, now) !== 'accepted') notice = '?welcome=unavailable';
    return { status: 303, body: '', headers: { location: `/me${notice}`, 'set-cookie': browserCookie(browser) } };
  }

  if (url.pathname === '/start/edit') {
    return saved ? page(200, { values: valuesOf(saved) }) : page(400, { note: 'signup.code.unknown' });
  }
  let signup: Signup;
  if (url.pathname === '/start/resend') {
    if (!saved) return page(400, { note: 'signup.code.unknown' });
    signup = saved;
  } else {
    const read = readSignup(form, now);
    if (!read.ok) {
      const values = Object.fromEntries(['name', 'phone', 'email', 'weekday', 'time', 'timezone'].map(k => [k, form.get(k) ?? '']));
      return page(400, { errors: read.errors, values });
    }
    signup = read.signup;
    await countRequest(store.raw, 'booking_submitted', now);
  }

  const hash = phoneKey(signup.phone);
  if (!perClient.take(client, +now) || !resendDelay.take(hash, +now) || !perNumber.take(hash, +now)) {
    return draft
      ? { status: 429, body: codePage(signup.phone, script, 'signup.code.limited', 'en', draft) }
      : page(429, { values: valuesOf(signup), note: 'signup.code.limited' });
  }
  let messageId = '';
  const challenge = await pending.begin(signup, now, async (tx, id, code) => {
    messageId = await enqueue(tx, { eventKey: `signup:${id}`, phoneHash: hash, channel: 'sms', kind: 'signup', reference: id,
      to: signup.phone, body: (script.get('sms.code') ?? '').replace('{{code}}', code), expiresAt: new Date(+now + 10 * 60_000) }, now);
  });
  const nextDraft = { id: challenge.id, signup };
  const delivery = await dispatchMessage(deps, messageId, now);
  if (delivery !== 'accepted') {
    if (delivery === 'failed' || delivery === 'suppressed') await pending.invalidate(challenge.id, now);
    return { status: 503, body: codePage(signup.phone, script, delivery === 'failed' || delivery === 'suppressed' ? 'signup.code.notsent' : 'signup.code.deliverypending', 'en', nextDraft) };
  }
  return { status: 200, body: codePage(signup.phone, script, undefined, 'en', nextDraft) };
}
