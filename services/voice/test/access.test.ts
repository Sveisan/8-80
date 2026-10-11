import { SendFailure } from '../src/messages/types.ts';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { AccessCodes } from '../src/access/codes.ts';
import { Pending } from '../src/signup/pending.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { controlPlane } from '../src/control.ts';
import { loadScript } from '../src/script.ts';
import { Links } from '../src/link/token.ts';
import { esc } from '../src/link/page.ts';
import { accountState } from '../src/link/account.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const opened = await openTestDb('access');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const script = loadScript();
const now = new Date('2026-10-02T10:00:00Z');
const phone = '+4791000001';
const hash = phoneKey(phone);
const slot = { weekday: 2, minute: 480, timezone: 'Europe/Oslo' };
const texts: { to: string; body: string }[] = [];
let failSms = false;
let client = 0;
const codes = () => new AccessCodes(db!.sql);
const sched = () => new Scheduler(db!.sql);
const form = (body: Record<string, string>, extra: Record<string, string> = {}): RequestInit => ({
  method: 'POST', body: new URLSearchParams(body), redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `198.51.100.${client}`, ...extra },
});
const idOf = (body: string): string => {
  const id = body.match(/name="id" value="([^"]+)"/)?.[1];
  assert.ok(id, 'the verification form carries its challenge');
  return id;
};
async function enrol(): Promise<void> {
  await db!.store.upsertProfile(phone, { name: 'Private name', email: 'private@example.com' });
  await sched().setSlot(phone, slot);
}
async function serve(body: (base: string) => Promise<void>): Promise<void> {
  client++;
  const deps: LoopDeps = {
    store: db!.store, scheduler: sched(), script,
    agent: { placeCall: async () => ({ conversationId: 'x', status: 'pending' }), conversation: async () => ({}) } as unknown as LoopDeps['agent'],
    mailer: { send: async () => undefined },
    sms: { send: async (to, text) => { if (failSms) throw new SendFailure('permanent', 'unavailable'); texts.push({ to, body: text }); } },
  };
  const server = controlPlane(deps, 'test');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>(r => server.close(() => r())); }
}
beforeEach(async () => {
  if (db) await db.sql`truncate belief_sessions, belief_enrollments, journey_events, journey_counts, message_attempts, message_outbox, callers, links, signups, access_codes, call_attempts`;
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  process.env['SIGNUP_OPEN'] = '0';
  process.env['TWILIO_ACCOUNT_SID'] = 'test';
  process.env['TWILIO_AUTH_TOKEN'] = 'test';
  process.env['SMS_FROM_NUMBER'] = '+4791000000';
  texts.length = 0;
  failSms = false;
});
after(async () => { await db?.close(); });

test('new-device recovery preserves the entire caller and pending signup while signup is closed', options, async () => {
  await enrol();
  await db!.sql`update callers set billing_status = 'trialing', trial_ends_at = now() + interval '12 days', paused = true`;
  const signupCode = await new Pending(db!.sql).start({ phone, email: 'different@example.com', name: 'Different', ...slot });
  const [before] = await db!.sql`select * from callers`;
  await serve(async base => {
    assert.equal((await fetch(`${base}/access`)).status, 200);
    const requested = await fetch(`${base}/access`, form({ phone }));
    assert.equal(requested.status, 200);
    const html = await requested.text();
    assert.ok(!html.includes('Private name') && !html.includes('private@example.com'));
    const code = texts[0]?.body.match(/\b\d{6}\b/)?.[0];
    assert.ok(code);
    const verified = await fetch(`${base}/access/verify`, form({ phone, id: idOf(html), code }));
    assert.equal(verified.status, 303);
    assert.match(verified.headers.get('location') ?? '', /^\/r\/[a-z2-9]+$/);
    const cookie = verified.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly; SameSite=Lax; Secure/);
    const page = await fetch(`${base}${verified.headers.get('location')}`);
    const content = await page.text();
    assert.ok(content.includes(esc(script.get('page.stopped')!)));
    assert.ok(content.includes('value="export"'), 'fresh phone proof opens full controls');
    const home = await fetch(`${base}/me`, { headers: { cookie: cookie.split(';')[0]! } });
    assert.ok(!(await home.text()).includes('value="export"'), 'remembered browser stays limited');
    const replay = await fetch(`${base}/access/verify`, form({ phone, id: idOf(html), code }));
    assert.equal(replay.status, 400);
  });
  const [after] = await db!.sql`select * from callers`;
  assert.deepEqual(after, before, 'recovery may not reset a trial, unpause, overwrite a slot or change context');
  assert.equal((await new Pending(db!.sql).verify(phone, signupCode)).ok, true, 'recovery does not consume a signup code');
});

test('unknown numbers have the same request page and create no caller or outbound text', options, async () => {
  await serve(async base => {
    const res = await fetch(`${base}/access`, form({ phone }));
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes(esc(script.get('access.code.detail')!)));
    assert.equal(texts.length, 0);
    assert.equal((await db!.sql`select * from callers`).length, 0);
  });
});

test('five wrong attempts, expiry and consumed codes all fail closed', options, async () => {
  const first = (await codes().start(hash, now))!;
  const wrong = first.code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal(await codes().verify(first.id, wrong, now), undefined);
  assert.equal(await codes().verify(first.id, first.code, now), undefined);
  const second = (await codes().start(hash, new Date(+now + 60_000)))!;
  assert.equal(await codes().verify(second.id, second.code, new Date(+now + 660_000)), undefined);
  const third = (await codes().start(hash, new Date(+now + 120_000)))!;
  assert.equal(await codes().verify(third.id, third.code, new Date(+now + 120_000)), hash);
  assert.equal(await codes().verify(third.id, third.code, new Date(+now + 120_000)), undefined);
});

test('concurrent verification can succeed only once', options, async () => {
  const challenge = (await codes().start(hash, now))!;
  const results = await Promise.all(Array.from({ length: 4 }, () => codes().verify(challenge.id, challenge.code, now)));
  assert.equal(results.filter(Boolean).length, 1);
});

test('resend invalidates older codes; cooldown and hourly limits survive a new service instance', options, async () => {
  const first = (await codes().start(hash, now))!;
  assert.equal(await codes().start(hash, now), undefined);
  const second = (await codes().start(hash, new Date(+now + 60_000)))!;
  assert.equal(await codes().verify(first.id, first.code, new Date(+now + 60_000)), undefined);
  assert.equal(await codes().verify(second.id, second.code, new Date(+now + 60_000)), hash);
  assert.ok(await codes().start(hash, new Date(+now + 120_000)));
  assert.equal(await codes().start(hash, new Date(+now + 180_000)), undefined);
  assert.ok(await codes().start(hash, new Date(+now + 3600_000)));
});

test('concurrent send requests cannot bypass the per-number cooldown', options, async () => {
  const requests = await Promise.all(Array.from({ length: 4 }, () => codes().start(hash, now)));
  assert.equal(requests.filter(Boolean).length, 1);
});

test('resending too early retains the code entry, and wrong codes offer resend and number correction', options, async () => {
  await enrol();
  await serve(async base => {
    const requested = await fetch(`${base}/access`, form({ phone }));
    const id = idOf(await requested.text());
    const early = await fetch(`${base}/access`, form({ phone, id }));
    assert.equal(early.status, 429);
    const limited = await early.text();
    assert.equal(idOf(limited), id);
    assert.ok(limited.includes('name="code"'));
    const wrong = await fetch(`${base}/access/verify`, form({ phone, id, code: 'invalid' }));
    const html = await wrong.text();
    assert.equal(wrong.status, 400);
    assert.ok(html.includes('action="/access"') && html.includes('href="/access"'));
    const verified = await fetch(`${base}/access/verify`, form({ phone, id, code: texts[0]!.body.match(/\b\d{6}\b/)![0] }));
    assert.equal(verified.status, 303, 'a rejected resend must leave the latest code working');
  });
});

test('expired links and expired browsers both offer recovery', options, async () => {
  await enrol();
  const expiredAt = new Date(Date.now() - 8 * 86400_000);
  const link = await new Links(db!.sql).mint(hash, expiredAt);
  const cookie = await new Links(db!.sql).mint(hash, expiredAt, 'browser');
  await serve(async base => {
    const expired = await fetch(`${base}/r/${link}`);
    assert.equal(expired.status, 410);
    assert.ok((await expired.text()).includes('href="/access"'));
    const browser = await fetch(`${base}/me`, { headers: { cookie: `browser=${cookie}` } });
    assert.ok((await browser.text()).includes('href="/access"'));
    assert.match(browser.headers.get('set-cookie') ?? '', /Max-Age=0/);
  });
});

test('recovery rejects cross-site posts, malformed numbers and oversized forms without sending', options, async () => {
  await enrol();
  await serve(async base => {
    for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://another.example' }] as Record<string, string>[]) {
      const res = await fetch(`${base}/access`, form({ phone }, headers));
      assert.equal(res.status, 403);
    }
    assert.equal((await fetch(`${base}/access`, form({ phone: 'invalid' }))).status, 400);
    assert.equal((await fetch(`${base}/access`, form({ phone, padding: 'x'.repeat(3000) }))).status, 413);
    assert.equal(texts.length, 0);
    assert.equal((await db!.sql`select * from access_codes`).length, 0);
  });
});

test('SMS failure is actionable, consumes no caller state and invalidates the challenge', options, async () => {
  await enrol(); failSms = true;
  await serve(async base => {
    const res = await fetch(`${base}/access`, form({ phone }));
    assert.equal(res.status, 503);
    assert.ok((await res.text()).includes(esc(script.get('access.unavailable')!)));
    const [row] = await db!.sql`select consumed from access_codes`;
    assert.equal(row!['consumed'], true);
  });
});

test('recovery without a configured SMS provider is unavailable and does not create a challenge', options, async () => {
  delete process.env['TWILIO_AUTH_TOKEN'];
  await serve(async base => {
    assert.equal((await fetch(`${base}/access`, form({ phone }))).status, 503);
    assert.equal((await db!.sql`select * from access_codes`).length, 0);
  });
});

test('a hidden number cannot retarget successful proof, and a recovery code cannot open a signup', options, async () => {
  await enrol();
  const challenge = (await codes().start(hash))!;
  await serve(async base => {
    const res = await fetch(`${base}/access/verify`, form({ phone: '+4791000002', ...challenge }));
    const token = res.headers.get('location')!.slice(3);
    const opened = await new Links(db!.sql).open(token);
    assert.ok(opened.ok);
    if (opened.ok) assert.equal(opened.claims.phoneHash, hash);
  });
  assert.equal((await new Pending(db!.sql).verify(phone, challenge.code)).ok, false);
});

test('expired recovery data is pruned, and deletion withdraws every recovery challenge', options, async () => {
  await enrol();
  await codes().start(hash, now);
  await codes().prune(new Date(+now + 3600_001));
  assert.equal((await db!.sql`select * from access_codes`).length, 0);
  const live = (await codes().start(hash))!;
  await db!.store.forget(phone);
  assert.equal(await codes().verify(live.id, live.code), undefined);
});

test('paused first-call and returning pages stay paused on reopen and reject stale move forms', options, async () => {
  await enrol();
  const token = await new Links(db!.sql).mint(hash);
  await serve(async base => {
    await fetch(`${base}/r/${token}`, form({ action: 'stop-confirm' }));
    for (const callNumber of [1, 3]) {
      await db!.sql`update callers set call_number = ${callNumber}`;
      const html = await (await fetch(`${base}/r/${token}`)).text();
      assert.ok(html.includes(esc(script.get('page.stopped')!)));
      assert.ok(html.includes('value="start"'));
      assert.ok(!html.includes('value="move"') && !html.includes('value="skip"'));
      const [before] = await db!.sql`select * from callers`;
      await fetch(`${base}/r/${token}`, form({ action: 'move', weekday: '4', time: '09:00', always: '1' }));
      assert.deepEqual((await db!.sql`select * from callers`)[0], before);
    }
    await fetch(`${base}/r/${token}`, form({ action: 'start' }));
    const state = await accountState(db!.sql, hash);
    assert.equal(state!.paused, false);
    assert.ok(state!.next);
  });
});

test('trial boundaries, paid and overdue states match scheduler eligibility, independently of pause', options, async () => {
  await enrol();
  const token = await new Links(db!.sql).mint(hash);
  const future = new Date(Date.now() + 5 * 86400_000);
  await db!.sql`update callers set next_call_at = ${future}, trial_ends_at = now() + interval '2 days', billing_status = 'trialing'`;
  assert.equal((await accountState(db!.sql, hash))!.next, undefined);
  await serve(async base => {
    for (const [billing, key] of [['trialing', 'page.no_next.trial'], ['active', 'page.paid'], ['past_due', 'page.payment_due'], ['comped', 'page.comped']]) {
      await db!.sql`update callers set billing_status = ${billing!}`;
      const html = await (await fetch(`${base}/r/${token}`)).text();
      assert.ok(html.includes(script.get(key!)!), billing);
      assert.ok(!html.includes('private@example.com'));
      assert.ok(html.includes('p•••@e•••.com'));
    }
    await db!.sql`update callers set billing_status = 'trialing', trial_ends_at = now() - interval '1 second', paused = true`;
    const html = await (await fetch(`${base}/r/${token}`)).text();
    assert.ok(!html.includes('value="start"') && !html.includes('value="move"'));
    for (const action of ['start', 'move']) await fetch(`${base}/r/${token}`, form({ action, weekday: '4', time: '09:00', always: '1' }));
    assert.equal((await accountState(db!.sql, hash))!.paused, true);
  });
});

test('completion pages lead back to the same authorised controls', options, async () => {
  await enrol();
  const token = await new Links(db!.sql).mint(hash);
  await serve(async base => {
    const res = await fetch(`${base}/r/${token}`, form({ action: 'move', weekday: '4', time: '09:00' }));
    const html = await res.text();
    assert.ok(html.includes(`href="/r/${token}"`));
    assert.ok(html.includes(script.get('page.back')!));
    const originAttack = await fetch(`${base}/r/${token}`, form({ action: 'stop-confirm' }, { origin: 'https://another.example' }));
    assert.equal(originAttack.status, 403);
  });
});

test('account deletion racing recovery leaves no working credentials', options, async () => {
  await enrol();
  const challenge = (await codes().start(hash))!;
  await serve(async base => {
    const [res] = await Promise.all([
      fetch(`${base}/access/verify`, form({ phone, ...challenge })),
      db!.store.forget(phone),
    ]);
    assert.ok([303, 400].includes(res.status));
    assert.equal((await db!.sql`select * from links where phone_hash = ${hash}`).length, 0);
    assert.equal((await db!.sql`select * from callers where phone_hash = ${hash}`).length, 0);
  });
});

test('a client cannot bypass send limits by prepending invented forwarded addresses', options, async () => {
  await serve(async base => {
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${base}/access`, form({ phone: `+47920000${String(i).padStart(2, '0')}` }, {
        'x-forwarded-for': `203.0.113.${i}, 198.51.100.${client}`,
      }));
      assert.equal(res.status, i < 10 ? 200 : 429);
    }
    assert.equal(texts.length, 0);
  });
});

test('a move cannot book outside the trial or undo a simultaneous pause', options, async () => {
  await enrol();
  const at = new Date(Date.now() + 7 * 86400_000);
  await db!.sql`update callers set billing_status = 'trialing', trial_ends_at = now() + interval '1 day'`;
  const [before] = await db!.sql`select * from callers`;
  assert.equal(await sched().moveIfActive(phone, at, slot), false);
  assert.deepEqual((await db!.sql`select * from callers`)[0], before);
  await db!.sql`update callers set billing_status = 'active'`;
  await Promise.all([sched().moveIfActive(phone, at, slot), sched().setPaused(phone, true)]);
  assert.equal((await accountState(db!.sql, hash))!.paused, true);
});

test('an expired trial remains identifiable after the expiry job has run', options, async () => {
  await enrol();
  const end = new Date(Date.now() - 3600_000);
  await db!.sql`update callers set billing_status = 'trialing', trial_ends_at = ${end}`;
  await db!.store.expireTrials();
  const state = await accountState(db!.sql, hash);
  assert.equal(state!.billing, 'trial_ended');
  assert.equal(state!.trialEnds?.toISOString(), end.toISOString());
  assert.equal(state!.canCall, false);
});

test('privacy headers allow same-origin null-origin forms, but reject unverified null origins', options, async () => {
  await serve(async base => {
    const home = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(home.headers.get('location'), '/access', 'returning callers can enter while signup is closed');
    const denied = await fetch(`${base}/access`, form({ phone }, { origin: 'null' }));
    assert.equal(denied.status, 403);
    const accepted = await fetch(`${base}/access`, form({ phone }, { origin: 'null', 'sec-fetch-site': 'same-origin' }));
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers.get('referrer-policy'), 'no-referrer');
  });
});
