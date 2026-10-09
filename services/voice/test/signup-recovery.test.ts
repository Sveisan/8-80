import { SendFailure } from '../src/messages/types.ts';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { loadScript } from '../src/script.ts';
import { Pending } from '../src/signup/pending.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { controlPlane } from '../src/control.ts';
import { phoneKey } from '../src/store/postgres.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const opened = await openTestDb('signup_recovery');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const script = loadScript();
const texts: string[] = [];
let fail = false;
let client = 0;
let number = 0;
const signup = () => ({ phone: `+47940000${String(++number).padStart(2, '0')}`, name: 'Mina', email: 'booking@example.com', weekday: 4, minute: 990, timezone: 'America/New_York' });
const hidden = (html: string, name: string): string => { const value = new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1]; assert.ok(value); return value; };
const post = (body: Record<string, string>): RequestInit => ({ method: 'POST', body: new URLSearchParams(body), redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `203.0.113.${++client}` } });
async function serve(body: (base: string) => Promise<void>): Promise<void> {
  const deps: LoopDeps = { store: db!.store, scheduler: new Scheduler(db!.sql), script, agent: {} as LoopDeps['agent'], mailer: { send: async () => undefined }, sms: { send: async (_to, text) => { if (fail) throw new SendFailure('permanent', 'synthetic delivery failure'); texts.push(text); } } };
  const server = controlPlane(deps, 'test');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
beforeEach(async () => {
  if (db) await db.sql`truncate journey_events, journey_counts, message_attempts, message_outbox, callers, links, signups, call_attempts`;
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 6).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example'; process.env['SIGNUP_OPEN'] = '1';
  process.env['TWILIO_ACCOUNT_SID'] = 'test'; process.env['TWILIO_AUTH_TOKEN'] = 'test'; process.env['SMS_FROM_NUMBER'] = '+4794000000';
  texts.length = 0; fail = false;
});
after(async () => { await db?.close(); });

test('booking explains the AI call and free month; wrong codes and early resend preserve all choices', options, async () => {
  const booking = signup();
  await serve(async base => {
    const landing = await (await fetch(`${base}/start`)).text();
    assert.match(landing, /Weekly AI calls\. Short email recaps\./);
    assert.match(landing, /30 days free, no card required/);
    assert.match(landing, /name="name"[\s\S]*?autocomplete="given-name"/);
    const request = await fetch(`${base}/start`, post({ ...booking, weekday: '4', time: '16:30', minute: '990' }));
    assert.equal(request.status, 200);
    const html = await request.text();
    const draft = hidden(html, 'draft');
    const wrong = await fetch(`${base}/start/verify`, post({ phone: booking.phone, draft, code: 'wrong' }));
    assert.equal(wrong.status, 400);
    assert.equal(hidden(await wrong.text(), 'draft'), draft);
    const resend = await fetch(`${base}/start/resend`, post({ draft }));
    assert.equal(resend.status, 429);
    const limited = await resend.text();
    assert.match(limited, /No new code was sent/);
    assert.doesNotMatch(limited, /on its way/);
    assert.equal(texts.length, 1);
    const edit = await fetch(`${base}/start/edit`, post({ draft }));
    assert.equal(edit.status, 200);
    const fields = await edit.text();
    for (const expected of [booking.name, booking.phone, booking.email, '16:30', 'America/New_York']) assert.ok(fields.includes(expected));
    assert.match(fields, /data-preserved="1"/);
    assert.deepEqual(await new Pending(db!.sql).draft(draft), booking);
    assert.equal(await db!.store.phoneFor(phoneKey(booking.phone)), undefined);
    const changed = { ...booking, phone: '+4794000099', weekday: '4', time: '16:30', minute: '990' };
    const corrected = await fetch(`${base}/start`, post(changed));
    assert.equal(corrected.status, 200);
    assert.equal((await new Pending(db!.sql).draft(hidden(await corrected.text(), 'draft')))?.timezone, booking.timezone);
  });
});

test('resend replaces the code capability while preserving the booking; verification is single-use under concurrency', options, async () => {
  const booking = signup();
  const pending = new Pending(db!.sql);
  const old = await pending.begin(booking);
  await serve(async base => {
    const resend = await fetch(`${base}/start/resend`, post({ draft: old.id }));
    assert.equal(resend.status, 200);
    const draft = hidden(await resend.text(), 'draft');
    assert.notEqual(draft, old.id);
    assert.equal(await pending.draft(old.id), undefined);
    assert.deepEqual(await pending.draft(draft), booking);
    assert.equal((await pending.verify(booking.phone, old.code, new Date(), old.id)).ok, false);
    const code = texts[0]?.match(/\b\d{6}\b/)?.[0]; assert.ok(code);
    const results = await Promise.all([pending.verify(booking.phone, code, new Date(), draft), pending.verify(booking.phone, code, new Date(), draft)]);
    assert.equal(results.filter(r => r.ok).length, 1);
  });
});

test('an expired code keeps its draft for correction for one hour, and a forged draft reveals nothing', options, async () => {
  const booking = signup();
  const pending = new Pending(db!.sql);
  const then = new Date(Date.now() - 11 * 60_000);
  const challenge = await pending.begin(booking, then);
  assert.deepEqual(await pending.verify(booking.phone, challenge.code), { ok: false, why: 'expired' });
  assert.deepEqual(await pending.draft(challenge.id), booking);
  assert.equal(await pending.draft(challenge.id, new Date(+then + 3600_001)), undefined);
  await serve(async base => {
    const forged = await fetch(`${base}/start/edit`, post({ draft: '00000000-0000-0000-0000-000000000000', phone: booking.phone }));
    assert.equal(forged.status, 400);
    const html = await forged.text();
    assert.ok(!html.includes(booking.phone) && !html.includes(booking.email));
  });
});

test('SMS delivery failure invalidates the code but leaves booking correction available', options, async () => {
  const booking = signup(); fail = true;
  await serve(async base => {
    const request = await fetch(`${base}/start`, post({ ...booking, weekday: '4', time: '16:30', minute: '990' }));
    assert.equal(request.status, 503);
    const html = await request.text();
    assert.doesNotMatch(html, /on its way/);
    assert.match(html, /couldn&#39;t get a text/);
    assert.deepEqual(await new Pending(db!.sql).draft(hidden(html, 'draft')), booking);
    const [row] = await db!.sql`select expires_at from signups`;
    assert.ok(row!['expires_at'] <= new Date());
    assert.equal((await db!.sql`select * from callers`).length, 0);
  });
});

test('an existing caller entering signup is recovered without changing their trial, pause, notes or slot', options, async () => {
  const booking = signup();
  await db!.store.upsertProfile(booking.phone, { email: 'original@example.com' });
  await new Scheduler(db!.sql).setSlot(booking.phone, { weekday: 2, minute: 480, timezone: 'Europe/Oslo' });
  await db!.sql`update callers set paused = true, onboarding = 'legacy', call_number = 5, billing_status = 'trialing', trial_ends_at = now() + interval '2 days'`;
  const [before] = await db!.sql`select * from callers`;
  const code = await new Pending(db!.sql).start(booking);
  await serve(async base => {
    const res = await fetch(`${base}/start/verify`, post({ phone: booking.phone, code }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/me');
  });
  const [after] = await db!.sql`select * from callers`;
  assert.deepEqual(after, before);
  assert.equal(texts.length, 0, 'no second welcome or verification send');
});

test('a failed welcome still lands a verified new caller on a usable confirmation', options, async () => {
  const booking = signup();
  const code = await new Pending(db!.sql).start(booking);
  fail = true;
  await serve(async base => {
    const res = await fetch(`${base}/start/verify`, post({ phone: booking.phone, code }));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/me?welcome=unavailable');
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    const page = await fetch(`${base}/me?welcome=unavailable`, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /could not confirm delivery of the welcome text/);
    const caller = await db!.store.load(booking.phone);
    assert.equal(caller.onboarding, 'pending');
    assert.equal(caller.name, booking.name);
  });
});

test('verification throttling explains the verification wait and keeps the booking available', options, async () => {
  const booking = signup();
  const challenge = await new Pending(db!.sql).begin(booking);
  await serve(async base => {
    const init = post({ phone: booking.phone, draft: challenge.id, code: 'wrong' });
    for (let i = 0; i < 30; i++) {
      const result = await fetch(`${base}/start/verify`, init);
      assert.equal(result.status, 400);
      await result.text();
    }
    const limited = await fetch(`${base}/start/verify`, init);
    assert.equal(limited.status, 429);
    const html = await limited.text();
    assert.match(html, /Wait ten minutes before trying again/);
    assert.doesNotMatch(html, /texts are limited|on its way/);
    assert.equal(hidden(html, 'draft'), challenge.id);
  });
});

test('checking the first date needs no contact details and sends no verification message', options, async () => {
  await serve(async base => {
    const preview = await fetch(`${base}/start/appointment?weekday=2&time=08%3A00&timezone=Europe%2FOslo`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-type') ?? '', /application\/json/);
    const answer = await preview.json() as { when: string };
    assert.match(answer.when, /Tuesday.*\d.*08:00/);
    const invalid = await fetch(`${base}/start/appointment?weekday=2&time=08%3A00&timezone=Not%2FAZone`);
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: 'invalid slot' });
    const checked = await fetch(`${base}/start/preview`, post({ name: 'Mina', phone: '900 33 575', email: 'unfinished', weekday: '2', time: '08:00', timezone: 'Europe/Oslo' }));
    assert.equal(checked.status, 200);
    const html = await checked.text();
    assert.match(html, /<noscript>[\s\S]*First call: Tuesday/);
    assert.match(html, /value="Mina"/);
    assert.match(html, /value="900 33 575"/);
    assert.match(html, /value="unfinished"/);
    assert.equal(texts.length, 0);
    assert.equal((await db!.sql`select * from signups`).length, 0);
    assert.equal((await db!.sql`select * from callers`).length, 0);
  });
});
