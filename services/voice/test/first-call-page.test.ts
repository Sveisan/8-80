import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { loadScript } from '../src/script.ts';
import { openTestDb } from './helpers/db.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Links } from '../src/link/token.ts';
import { Pending } from '../src/signup/pending.ts';
import { controlPlane } from '../src/control.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

/**
 * Between signing up and the first call: the browser that signed up lands on
 * its own page and is remembered for a week, and the page offers what makes
 * sense before a call has happened. SCRIPT.md §19.
 */

const KEY = Buffer.alloc(32, 7).toString('base64');
const script = loadScript();
/** A script line as the page writes it: escaped, so "doesn't" is "doesn&#39;t". */
const line = (key: string): string =>
  (script.get(key) ?? '\u0000').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const opened = await openTestDb('first_call_page');
const unreachable = typeof opened === 'string' ? opened : false;
const skip = () => unreachable;
const db = typeof opened === 'string' ? undefined : opened;
const sql = db?.sql;
const store = db?.store;
const sched = sql ? new Scheduler(sql) : undefined;

const deps = (): LoopDeps => ({
  store: store as NonNullable<typeof store>,
  scheduler: sched as Scheduler,
  agent: { placeCall: async () => ({ conversationId: 'x', status: 'pending' }), conversation: async () => ({}) } as unknown as LoopDeps['agent'],
  mailer: { send: async () => undefined },
  sms: { send: async () => undefined },
  script,
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  if (sql) await sql`truncate table message_attempts, message_outbox, callers, call_attempts, links, signups`;
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
  for (const k of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM_NUMBER']) delete process.env[k];
});

/** Always closes the server, so a failing assertion is a red line rather than a hang. */
async function serving(body: (base: string) => Promise<void>): Promise<void> {
  const server = controlPlane(deps(), 'whsec_x');
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  try {
    await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const form = (o: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(o),
  redirect: 'manual' as const,
});

const withCookie = (cookie: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  redirect: 'manual',
  headers: { ...(init.headers as Record<string, string> | undefined), cookie },
});

/** Signs somebody up the whole way, and returns the cookie the browser was given. */
async function signUp(base: string, phone: string): Promise<string> {
  const code = await new Pending(sql as NonNullable<typeof sql>).start({
    phone,
    email: 'eirik@example.com',
    name: 'Eirik',
    weekday: 2,
    minute: 8 * 60,
    timezone: 'Europe/Oslo',
  });
  const res = await fetch(`${base}/start/verify`, form({ phone, code }));
  assert.equal(res.status, 303, 'verifying goes straight to their page');
  assert.equal(res.headers.get('location'), '/me');
  const set = res.headers.get('set-cookie') ?? '';
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Lax/);
  assert.match(set, /Max-Age=604800/, 'a week, the life of the link in the welcome text');
  return set.split(';')[0] as string;
}

test('the browser that signed up lands on its own page, and it says done', { skip: skip() }, async () => {
  await serving(async (base) => {
    const cookie = await signUp(base, '+4790000101');
    const res = await fetch(`${base}/me`, withCookie(cookie));
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes(script.get('page.booked') ?? ''), 'says it is done');
    assert.match(body, /Tuesday/);
    // The time and the address, and the calm version of the page.
    assert.ok(body.includes('name="weekday"') && body.includes('name="time"'), 'the time can be changed here');
    assert.ok(body.includes('value="email"'));
    // Nothing about the person, as on every other version of this page.
    assert.ok(!body.includes('Eirik'), 'no name');
    assert.ok(!body.includes('4790000101'), 'no number');
    assert.ok(!body.includes('eirik@example.com'), 'not even the address');
    assert.ok(!/sign in|log in|login|type="password"/i.test(body), 'and nothing that looks like an account');
  });
});

test('a remembered browser cannot export or delete, and says where those are', { skip: skip() }, async () => {
  const phone = '+4790000102';
  await serving(async (base) => {
    const cookie = await signUp(base, phone);
    const page = await (await fetch(`${base}/me`, withCookie(cookie))).text();
    assert.ok(!page.includes('value="export"'), 'no copy from a cookie');
    assert.ok(!page.includes('value="forget"'), 'no deletion from a cookie');
    assert.ok(page.includes(line('page.browser.rest')), 'and the page says where they are');

    // Posted anyway, by hand: refused, and nothing is gone.
    for (const action of ['forget', 'forget-confirm', 'export']) {
      const res = await fetch(`${base}/me`, withCookie(cookie, form({ action })));
      assert.equal(res.status, 200);
      assert.ok(!(await res.text()).includes(line('page.forgotten')));
    }
    assert.ok(await (store as NonNullable<typeof store>).phoneFor(phoneKey(phone)), 'the caller is still there');
  });
});

test('the cookie and the link do not open each other', { skip: skip() }, async () => {
  const phone = '+4790000103';
  await serving(async (base) => {
    const cookie = await signUp(base, phone);
    const browserCode = cookie.split('=')[1] as string;
    // A cookie pasted into a link must not get the whole page.
    assert.equal((await fetch(`${base}/r/${browserCode}`)).status, 410);
    // And a link's code set as a cookie is not a remembered browser.
    const link = await new Links(sql as NonNullable<typeof sql>).mint(phoneKey(phone));
    const res = await fetch(`${base}/me`, withCookie(`browser=${link}`));
    assert.ok((await res.text()).includes(line('page.browser.gone')));
    assert.match(res.headers.get('set-cookie') ?? '', /Max-Age=0/, 'a dead cookie is cleared, not kept');
  });
});

test('the bare address goes to their page; /start is still the form', { skip: skip() }, async () => {
  process.env['SIGNUP_OPEN'] = '1';
  process.env['TWILIO_ACCOUNT_SID'] = 'AC1';
  process.env['TWILIO_AUTH_TOKEN'] = 't';
  process.env['SMS_FROM_NUMBER'] = '+4700000000';
  try {
    await serving(async (base) => {
      const phone = '+4790000104';
      // Minted directly: signing up through the form would try to reach Twilio.
      await (store as NonNullable<typeof store>).upsertProfile(phone, { name: 'x' });
      await (sched as Scheduler).setSlot(phone, { weekday: 2, minute: 480, timezone: 'Europe/Oslo' });
      const code = await new Links(sql as NonNullable<typeof sql>).mint(phoneKey(phone), new Date(), 'browser');

      const home = await fetch(`${base}/`, withCookie(`browser=${code}`));
      assert.equal(home.status, 303);
      assert.equal(home.headers.get('location'), '/me');

      // The explicit way out must bypass that remembered-browser redirect.
      const account = await (await fetch(`${base}/me`, withCookie(`browser=${code}`))).text();
      const back = /<nav class="page-nav">[\s\S]*?<a href="([^"]+)"/.exec(account)?.[1];
      assert.ok(back, 'the call page has a visible way back');
      const welcome = await fetch(`${base}${back}`, withCookie(`browser=${code}`));
      assert.equal(welcome.status, 200, 'going back must not redirect to the call page again');
      assert.match(await welcome.text(), /action="\/start"/);

      // Somebody else on the same browser can still sign themselves up.
      const start = await fetch(`${base}/start`, withCookie(`browser=${code}`));
      assert.equal(start.status, 200);
      assert.match(await start.text(), /action="\/start"/);

      // And a browser nobody signed up on sees the form at the bare address.
      assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).status, 200);
    });
  } finally {
    for (const k of ['SIGNUP_OPEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM_NUMBER']) delete process.env[k];
  }
});

test('a browser without the cookie is told where the way in is, not asked to sign in', { skip: skip() }, async () => {
  await serving(async (base) => {
    const res = await fetch(`${base}/me`, { redirect: 'manual' });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes(line('page.browser.gone.detail')));
    assert.ok(!/type="password"|sign in|log in/i.test(body));
  });
});

test('a post from another site is refused', { skip: skip() }, async () => {
  const phone = '+4790000105';
  await serving(async (base) => {
    const cookie = await signUp(base, phone);
    const res = await fetch(
      `${base}/me`,
      withCookie(cookie, { ...form({ action: 'stop-confirm' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'cross-site' } }),
    );
    assert.equal(res.status, 403);
    const rows = await (sql as NonNullable<typeof sql>)`select paused from callers`;
    assert.equal(rows[0]?.['paused'], false);
  });
});

test('the cookie lasts a week and deleting everything withdraws it', { skip: skip() }, async () => {
  const phone = '+4790000106';
  const links = new Links(sql as NonNullable<typeof sql>);
  const code = await links.mint(phoneKey(phone), new Date(), 'browser');
  assert.ok((await links.open(code, new Date(Date.now() + 6 * 24 * 3600_000), 'browser')).ok);
  assert.equal((await links.open(code, new Date(Date.now() + 8 * 24 * 3600_000), 'browser')).ok, false);

  await (store as NonNullable<typeof store>).upsertProfile(phone, { name: 'x' });
  await (store as NonNullable<typeof store>).forget(phone);
  assert.equal((await links.open(code, new Date(), 'browser')).ok, false);
});

test('before the first call, a new time moves the booking, and there is no week to skip', { skip: skip() }, async () => {
  const phone = '+4790000107';
  await serving(async (base) => {
    const cookie = await signUp(base, phone);
    const page = await (await fetch(`${base}/me`, withCookie(cookie))).text();
    assert.ok(!page.includes('value="later"'), '"try again later today" means nothing before a call');
    assert.ok(!page.includes('value="skip"'), 'SKIP writes nothing, so it would promise a skip and ring anyway');
    assert.ok(!page.includes('value="goals"'), 'the first call makes the list and reads nothing added before it');

    const before = await (sql as NonNullable<typeof sql>)`select next_call_at from callers`;
    // Posted anyway: nothing moves.
    await fetch(`${base}/me`, withCookie(cookie, form({ action: 'later' })));
    const still = await (sql as NonNullable<typeof sql>)`select next_call_at from callers`;
    assert.deepEqual(still[0]?.['next_call_at'], before[0]?.['next_call_at']);

    await fetch(`${base}/me`, withCookie(cookie, form({ action: 'move', weekday: '4', time: '07:30', always: '1' })));
    const rows = await (sql as NonNullable<typeof sql>)`select slot_weekday, slot_minute from callers`;
    assert.equal(rows[0]?.['slot_weekday'], 4, 'the booking itself moved, not one week of it');
    assert.equal(rows[0]?.['slot_minute'], 450);
  });
});

test('after a call, goals can be added from the link and are never shown back', { skip: skip() }, async () => {
  const phone = '+4790000108';
  const s_ = store as NonNullable<typeof store>;
  await s_.upsertProfile(phone, { name: 'x' });
  await (sched as Scheduler).setSlot(phone, { weekday: 2, minute: 480, timezone: 'Europe/Oslo' });
  await (sql as NonNullable<typeof sql>)`update callers set call_number = 2`;
  await s_.record(phone, { at: new Date().toISOString(), durationMs: 1, onboardingComplete: true, goals: 'run a half marathon' });
  const token = await new Links(sql as NonNullable<typeof sql>).mint(phoneKey(phone));

  await serving(async (base) => {
    const page = await (await fetch(`${base}/r/${token}`)).text();
    assert.ok(page.includes('value="goals"'), 'the field is there once a call has made the list');
    assert.ok(!page.includes('half marathon'), 'and the list is not');

    const res = await fetch(`${base}/r/${token}`, form({ action: 'goals', goals: '  learn   to sail ' }));
    const body = await res.text();
    assert.ok(body.includes(line('page.goals.saved')));
    assert.ok(!body.includes('learn to sail') && !body.includes('half marathon'), 'not shown back, even just after');
    assert.equal((await s_.load(phone)).goals, 'run a half marathon\nlearn to sail', 'added to, not replaced');

    // A list that would run past what the call can carry is refused whole.
    const long = await fetch(`${base}/r/${token}`, form({ action: 'goals', goals: 'x'.repeat(400) }));
    await long.text();
    for (let i = 0; i < 5; i++) await (await fetch(`${base}/r/${token}`, form({ action: 'goals', goals: 'y'.repeat(400) }))).text();
    assert.ok(((await s_.load(phone)).goals ?? '').length <= 2000);
  });
});

test('every line the page before the first call says is in SCRIPT.md', () => {
  for (const key of [
    'page.first', 'page.first.detail', 'page.first.pick',
    'page.goals.label', 'page.goals.detail', 'page.goals.save', 'page.goals.saved', 'page.goals.full',
    'page.browser.rest', 'page.browser.gone', 'page.browser.gone.detail',
  ]) {
    const line = script.get(key);
    assert.ok(line, `${key} is missing`);
    assert.ok(!line.includes('!'), `${key} has an exclamation mark`);
  }
});
