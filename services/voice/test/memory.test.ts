import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { loadScript } from '../src/script.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { controlPlane } from '../src/control.ts';
import { Links } from '../src/link/token.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { readMemory, correctMemory } from '../src/memory/context.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const opened = await openTestDb('memory');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const phone = '+4793000001';
const hash = phoneKey(phone);
const script = loadScript();
const texts: string[] = [];
let client = 0;
const form = (body: Record<string, string>, cookie = '', extra: Record<string, string> = {}): RequestInit => ({ method: 'POST', body: new URLSearchParams(body), redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `198.51.100.${++client}`, ...extra } });
const get = (cookie: string): RequestInit => ({ redirect: 'manual', headers: { cookie } });
const hidden = (html: string, name: string): string => { const value = new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1]; assert.ok(value); return value; };
async function serve(body: (base: string) => Promise<void>): Promise<void> {
  const deps: LoopDeps = { store: db!.store, scheduler: new Scheduler(db!.sql), script, agent: {} as LoopDeps['agent'], mailer: { send: async () => undefined }, sms: { send: async (_to, text) => { texts.push(text); } } };
  const server = controlPlane(deps, 'test');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  try { await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }
}
async function enrol(): Promise<void> {
  await db!.store.upsertProfile(phone, { email: 'private@example.com' });
  await new Scheduler(db!.sql).setSlot(phone, { weekday: 2, minute: 480, timezone: 'Europe/Oslo' });
  await db!.store.record(phone, { at: new Date().toISOString(), durationMs: 300_000, onboardingComplete: true, commitment: 'Private commitment', day: 'Thursday', goals: 'Private goals' });
}
async function freshMemory(base: string): Promise<string> {
  const response = await fetch(`${base}/access`, form({ phone, intent: 'memory' }));
  assert.equal(response.status, 200);
  const code = texts.at(-1)?.match(/\b\d{6}\b/)?.[0]; assert.ok(code);
  const verified = await fetch(`${base}/access/verify`, form({ phone: '+4793000009', intent: 'memory', id: hidden(await response.text(), 'id'), code }));
  assert.equal(verified.status, 303);
  assert.equal(verified.headers.get('location'), '/memory');
  const cookies = verified.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  const memory = cookies.find(c => c.startsWith('memory=')); assert.ok(memory);
  assert.match(memory, /Path=\/memory; Max-Age=900; HttpOnly; SameSite=Strict; Secure/);
  return cookies.map(c => c.split(';')[0]).join('; ');
}
beforeEach(async () => {
  if (db) await db.sql`truncate journey_events, journey_counts, message_attempts, message_outbox, callers, links, access_codes, call_attempts`;
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 5).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  process.env['TWILIO_ACCOUNT_SID'] = 'test'; process.env['TWILIO_AUTH_TOKEN'] = 'test'; process.env['SMS_FROM_NUMBER'] = '+4793000000';
  texts.length = 0;
});
after(async () => { await db?.close(); });

test('ordinary browser and SMS credentials cannot reveal private context', options, async () => {
  await enrol();
  const links = new Links(db!.sql);
  const browser = await links.mint(hash, new Date(), 'browser');
  const sms = await links.mint(hash);
  await serve(async base => {
    for (const cookie of ['', `memory=${browser}`, `memory=${sms}`, `browser=${browser}`]) {
      const res = await fetch(`${base}/memory`, get(cookie));
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), '/access?for=memory');
      assert.doesNotMatch(await res.text(), /Private commitment|Private goals/);
    }
    for (const path of ['/me', `/r/${sms}`]) {
      const html = await (await fetch(`${base}${path}`, get(`browser=${browser}`))).text();
      assert.doesNotMatch(html, /Private commitment|Private goals/);
      assert.match(html, /href="\/memory"/);
    }
  });
});

test('fresh verification opens only its own notes; correction preserves account state and escapes markup', options, async () => {
  await enrol();
  const [before] = await db!.sql`select next_call_at, trial_ends_at, onboarding, call_number, paused from callers`;
  await serve(async base => {
    const cookie = await freshMemory(base);
    const page = await fetch(`${base}/memory`, get(cookie));
    assert.equal(page.status, 200);
    assert.match(page.headers.get('cache-control') ?? '', /no-store/);
    const html = await page.text();
    assert.match(html, /Private commitment/);
    const saved = await fetch(`${base}/memory`, form({ action: 'save', revision: hidden(html, 'revision'), commitment: 'Book a lesson <script>alert(1)</script>', goals: 'Sail every month' }, cookie));
    assert.equal(saved.status, 200);
    const savedHtml = await saved.text();
    assert.match(savedHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(savedHtml, /<script>alert/);
    const record = await db!.store.load(phone);
    assert.equal(record.lastCommitment, 'Book a lesson <script>alert(1)</script>');
    assert.equal(record.lastCommitmentDay, undefined, 'a corrected action must not retain an unrelated deadline');
    assert.equal(record.goals, 'Sail every month');
    const [after] = await db!.sql`select next_call_at, trial_ends_at, onboarding, call_number, paused from callers`;
    assert.deepEqual(after, before);
  });
});

test('a stale form cannot overwrite a newer call; blank values deliberately clear notes', options, async () => {
  await enrol();
  await serve(async base => {
    const cookie = await freshMemory(base);
    const html = await (await fetch(`${base}/memory`, get(cookie))).text();
    await db!.store.record(phone, { at: new Date().toISOString(), durationMs: 300_000, commitment: 'Newer commitment' });
    const stale = await fetch(`${base}/memory`, form({ action: 'save', revision: hidden(html, 'revision'), commitment: 'Old page change', goals: 'Old goals' }, cookie));
    assert.equal(stale.status, 409);
    const current = await stale.text();
    assert.match(current, /Newer commitment/);
    assert.equal((await db!.store.load(phone)).lastCommitment, 'Newer commitment');
    const clear = await fetch(`${base}/memory`, form({ action: 'save', revision: hidden(current, 'revision'), commitment: '', goals: '' }, cookie));
    assert.equal(clear.status, 200);
    const record = await db!.store.load(phone);
    assert.equal(record.lastCommitment, undefined);
    assert.equal(record.goals, undefined);
  });
});

test('cross-site writes are refused, Done invalidates the session, and expiry requires fresh proof', options, async () => {
  await enrol();
  await serve(async base => {
    const cookie = await freshMemory(base);
    const page = await (await fetch(`${base}/memory`, get(cookie))).text();
    const bad = await fetch(`${base}/memory`, form({ action: 'save', revision: hidden(page, 'revision'), commitment: 'tampered', goals: '' }, cookie, { origin: 'https://other.example' }));
    assert.equal(bad.status, 403);
    assert.equal((await db!.store.load(phone)).lastCommitment, 'Private commitment');
    const done = await fetch(`${base}/memory`, form({ action: 'done' }, cookie));
    assert.equal(done.status, 303);
    assert.match(done.headers.get('set-cookie') ?? '', /Max-Age=0/);
    assert.equal((await fetch(`${base}/memory`, get(cookie))).status, 303);
    const expired = await new Links(db!.sql).mint(hash, new Date(Date.now() - 901_000), 'memory');
    assert.equal((await fetch(`${base}/memory`, get(`memory=${expired}`))).status, 303);
  });
});

test('deletion revokes private access and a deleted record cannot be recreated by a correction', options, async () => {
  await enrol();
  const memory = await readMemory(db!.sql, hash); assert.ok(memory);
  const token = await new Links(db!.sql).mint(hash, new Date(), 'memory');
  await db!.store.forget(phone);
  assert.equal((await new Links(db!.sql).open(token, new Date(), 'memory')).ok, false);
  assert.equal(await correctMemory(db!.sql, hash, memory.revision, 'restore', 'restore'), 'missing');
  assert.equal(await readMemory(db!.sql, hash), undefined);
});
