import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { projectReview, matches, recentReviews, type ReviewRow } from '../src/quality/dashboard.ts';
import { qualityPage } from '../src/quality/page.ts';
import { JEV_MODEL } from '../src/quality/jev.ts';
import { openTestDb } from './helpers/db.ts';
import { controlPlane } from '../src/control.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Links } from '../src/link/token.ts';
import { AccessCodes } from '../src/access/codes.ts';
import { loadScript } from '../src/script.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const now = new Date();
const startedAt = new Date(+now - 3_600_000);
const report = (a: number, b: number) => JSON.stringify({ jev: { status: 'reviewed', model: JEV_MODEL,
  repeatedQuestion: { state: a >= .7 ? 'flag' : a <= .3 ? 'clear' : 'uncertain', probability: a },
  unsupportedRecap: { state: b >= .7 ? 'flag' : b <= .3 ? 'clear' : 'uncertain', probability: b } } });
const row = (value = report(.9, .5)): ReviewRow => ({ id: '<script>private</script>', ended_at: now, claimed_at: now,
  state: 'reviewed', report: value, finished_at: now });

test('dashboard treats ambiguity, partial/malformed reviews and missing sources as unresolved', () => {
  const both = projectReview(row(), startedAt);
  assert.ok(matches(both, 'flagged')); assert.ok(matches(both, 'uncertain')); assert.ok(!matches(both, 'clear'));
  for (const score of [.3, .7]) assert.equal(projectReview(row(report(score, score))).repeated.state, score === .3 ? 'clear' : 'flag');
  const partial = JSON.parse(report(.1, .1)); partial.jev.unsupportedRecap = { state: 'unavailable', reason: 'no_recap' };
  assert.ok(matches(projectReview(row(JSON.stringify(partial))), 'unavailable'));
  for (const input of ['not json', '{}', JSON.stringify({ jev: { status: 'reviewed', model: 'wrong' } })]) {
    assert.ok(matches(projectReview(row(input)), 'unavailable'));
    assert.ok(!matches(projectReview(row(input)), 'clear'));
  }
  const inconsistent = JSON.parse(report(.9, .1)); inconsistent.jev.repeatedQuestion.state = 'clear';
  assert.equal(projectReview(row(JSON.stringify(inconsistent))).repeated.state, 'unavailable');
  assert.equal(projectReview({ ...row(), state: null }, startedAt).state, 'pending');
  assert.equal(projectReview({ ...row(), state: null, claimed_at: new Date(0) }, startedAt).state, 'not_reviewed');
});

test('dashboard escapes identifiers, paginates filters and has explicit empty states', () => {
  const calls = Array.from({ length: 61 }, () => projectReview(row()));
  const html = qualityPage(calls, 'uncertain', 1, now, true);
  assert.ok(html.includes('&lt;script&gt;private&lt;/script&gt;'));
  assert.equal((html.match(/<script\b/g) ?? []).length, 2);
  assert.equal((html.match(/<script data-site-theme>/g) ?? []).length, 2);
  assert.equal((html.match(/<article /g) ?? []).length, 50);
  assert.ok(html.includes('Page 1 of 2')); assert.ok(html.includes('90.0%')); assert.ok(html.includes('50.0%'));
  assert.equal((qualityPage(calls, 'uncertain', 2, now, true).match(/<article /g) ?? []).length, 11);
  assert.ok(qualityPage(calls, 'clear', 1, now, false).includes('No calls match this filter'));
  assert.ok(qualityPage([], 'all', 1, now, true).includes('No recent completed weekly calls'));
});

test('private HTTP route verifies owner phone proof, filters real DB rows, and revokes signout', async t => {
  const opened = await openTestDb('quality_dashboard');
  if (typeof opened === 'string') { t.skip(opened); return; }
  const db = opened, env = { ...process.env };
  const phone = '+4791000091', other = '+4791000092', hash = phoneKey(phone);
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 9).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  process.env['TWILIO_ACCOUNT_SID'] = process.env['TWILIO_AUTH_TOKEN'] = 'fictional';
  process.env['SMS_FROM_NUMBER'] = '+4791000000';
  process.env['CALL_QUALITY_OWNER_PHONE_HASH'] = hash;
  process.env['JEV_REVIEW_STARTED_AT'] = startedAt.toISOString();
  const deps = { store: db.store, script: loadScript(), sms: { send: async () => ({ id: 'fictional' }) } } as unknown as LoopDeps;
  const server = controlPlane(deps, 'fictional');
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string, token?: string) => fetch(base + path, { redirect: 'manual', headers: token ? { cookie: `browser=${token}` } : {} });
  try {
    await db.store.upsertProfile(phone, { name: 'NEVER_RENDER_NAME', email: 'NEVER_RENDER_EMAIL' });
    await db.store.upsertProfile(other, { name: 'Other' });
    const owner = await new Links(db.sql).mint(hash, now, 'browser');
    const wrongOwner = await new Links(db.sql).mint(phoneKey(other), now, 'browser');
    const wrongPurpose = await new Links(db.sql).mint(hash, now, 'reschedule');
    const expired = await new Links(db.sql).mint(hash, new Date(+now - 8 * 86_400_000), 'browser');
    assert.equal((await get('/call-quality')).status, 401);
    assert.equal((await get('/call-quality', wrongOwner)).status, 403);
    for (const token of [wrongPurpose, expired, 'invalid']) assert.equal((await get('/call-quality', token)).status, 401);
    const signin = await (await get('/access?for=call-quality')).text();
    assert.ok(signin.includes('name="intent" value="call-quality"'));
    const challenge = await new AccessCodes(db.sql).start(hash, now); assert.ok(challenge);
    // The proved challenge, not the supplied phone field, controls the minted owner session.
    const verified = await fetch(base + '/access/verify', { method: 'POST', redirect: 'manual',
      body: new URLSearchParams({ intent: 'call-quality', phone: other, id: challenge.id, code: challenge.code }) });
    assert.equal(verified.status, 303); assert.equal(verified.headers.get('location'), '/call-quality');
    const proved = verified.headers.getSetCookie().find(v => v.startsWith('browser='))?.split(';')[0]?.slice(8);
    assert.ok(proved); assert.equal((await get('/call-quality', proved)).status, 200);
    for (const [id, age, safety] of [['flagged', 60_000, null], ['partial', 120_000, null], ['expired', 180_000, null], ['old', 15 * 86_400_000, null], ['safety', 240_000, 1]] as const) {
      await db.sql`insert into call_attempts (id,phone_hash,scheduled_for,claimed_at,ended_at,status,safety_tier)
        values (${id},${hash},${new Date(+now - age)},${new Date(+now - age)},${new Date(+now - age)},'completed',${safety})`;
      await db.sql`insert into jev_quality_reviews (attempt_id,phone_hash,state,report,started_at,expires_at)
        values (${id},${hash},'reviewed',${report(.9, .5)},${now},${new Date(+now + (id === 'expired' ? -1000 : 86_400_000))})`;
    }
    await db.sql`update jev_quality_reviews set report='broken' where attempt_id='partial'`;
    const rows = await recentReviews(db.sql, now, startedAt);
    assert.deepEqual(rows.map(r => r.id), ['flagged', 'partial', 'expired']);
    assert.equal(rows.find(r => r.id === 'partial')?.state, 'unavailable');
    assert.notEqual(rows.find(r => r.id === 'expired')?.state, 'reviewed');
    const result = await get('/call-quality?filter=flagged', owner), html = await result.text();
    assert.equal(result.status, 200); assert.equal((html.match(/<article /g) ?? []).length, 1);
    assert.ok(!html.includes('NEVER_RENDER')); assert.ok(!html.includes(phone)); assert.ok(!html.includes(hash));
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    assert.ok(result.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    const blocked = await fetch(base + '/call-quality/signout', { method: 'POST', headers: { cookie: `browser=${owner}`, origin: 'https://evil.example' } });
    assert.equal(blocked.status, 403); assert.equal((await get('/call-quality', owner)).status, 200);
    const out = await fetch(base + '/call-quality/signout', { method: 'POST', redirect: 'manual', headers: { cookie: `browser=${owner}` } });
    assert.equal(out.status, 303); assert.equal((await get('/call-quality', owner)).status, 401);
    delete process.env['CALL_QUALITY_OWNER_PHONE_HASH'];
    assert.equal((await get('/call-quality', proved)).status, 404);
  } finally {
    await new Promise<void>(r => server.close(() => r())); await db.close();
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
