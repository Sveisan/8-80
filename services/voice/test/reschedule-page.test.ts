import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { loadScript } from '../src/script.ts';
import { openTestDb } from './helpers/db.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { Links } from '../src/link/token.ts';
import { controlPlane } from '../src/control.ts';
import { nextSlotAfter, type Slot } from '../src/schedule/time.ts';
import { moveVersion } from '../src/link/move.ts';
import { skipReceipt } from '../src/link/undo-skip.ts';
import type { LoopDeps } from '../src/loop/deps.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OSLO: Slot = { weekday: 2, minute: 8 * 60, timezone: 'Europe/Oslo' };
const script = loadScript();

const opened = await openTestDb('reschedule_page');
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
  if (sql) await sql`truncate unblock_refund_requests,unblock_incidents,jev_quality_reviews,product_feedback,belief_sessions,unblock_sessions, belief_refund_requests, belief_enrollments,unblock_enrollments, message_attempts, message_outbox, callers, call_attempts, links`;
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
});

/**
 * Runs the body against a listening control plane and always closes it.
 *
 * A `stop()` after the assertions is a `stop()` that does not run when one
 * fails, and a listening server keeps the process alive — so a failing test
 * becomes a hanging suite with no output, which is far more expensive to read
 * than a red line.
 */
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

async function enrolled(phone: string): Promise<string> {
  await (store as NonNullable<typeof store>).upsertProfile(phone, { name: 'Eirik' });
  await (sched as Scheduler).setSlot(phone, OSLO, new Date('2026-09-07T10:00:00Z'));
  return await new Links(sql as NonNullable<typeof sql>).mint(phoneKey(phone));
}

const post = (base: string, token: string, form: Record<string, string>) =>
  fetch(`${base}/r/${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    redirect: 'manual',
  });

test('the page opens and shows the slot and nothing else', { skip: skip() }, async () => {
  const token = await enrolled('+4790000060');
  await (store as NonNullable<typeof store>).record('+4790000060', {
    at: new Date().toISOString(),
    durationMs: 1,
    commitment: 'phone my brother',
    day: 'wednesday',
  });

  await serving(async (base) => {
  const res = await fetch(`${base}/r/${token}`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /Tuesday/);
  assert.match(body, /08:00/);
  // Whoever is holding the phone should find this page boring.
  assert.ok(!body.includes('phone my brother'), 'the commitment must never be on a page reachable by link');
  assert.ok(!body.includes('4790000060'), 'nor the number');
  assert.ok(!body.includes('Eirik'), 'nor their name');
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  });
});

test('a tap moves this week and leaves the arrangement alone', { skip: skip() }, async () => {
  const token = await enrolled('+4790000061');
  await serving(async (base) => {

  const res = await post(base, token, { action: 'move', weekday: '3', time: '09:00' });
  assert.equal(res.status, 200);

  const rows = await (sql as NonNullable<typeof sql>)`select slot_weekday, next_call_at from callers`;
  assert.equal(rows[0]?.['slot_weekday'], 2, 'the standing slot is untouched');
  const next = rows[0]?.['next_call_at'] as Date;
  assert.equal(next.getUTCDay(), 3);
  });
});

test('ticking "every week" moves the standing slot', { skip: skip() }, async () => {
  const token = await enrolled('+4790000062');
  await serving(async (base) => {
  await post(base, token, { action: 'move', weekday: '4', time: '07:30', always: '1' });

  const rows = await (sql as NonNullable<typeof sql>)`select slot_weekday, slot_minute from callers`;
  assert.equal(rows[0]?.['slot_weekday'], 4);
  assert.equal(rows[0]?.['slot_minute'], 450);
  });
});

test('a skip form targets the displayed appointment and cannot skip twice', { skip: skip() }, async () => {
  const phone = '+4790000063';
  const token = await enrolled(phone);
  await (store as NonNullable<typeof store>).record(phone, { at: new Date().toISOString(), durationMs: 300_000, onboardingComplete: true });
  const next = await (sched as Scheduler).setSlot(phone, OSLO);
  await serving(async (base) => {
    const body = await (await fetch(`${base}/r/${token}`)).text();
    const skipAt = /name="skip_at" value="([^"]+)"/.exec(body)?.[1];
    assert.equal(skipAt, next.toISOString(), 'the occurrence the page names is the one submitted');
    assert.match(body, /Skip this call/);
    assert.ok(!body.includes('value="later"'), 'no action guesses an hour');

    const form = { action: 'skip', skip_at: skipAt as string };
    const first = await post(base, token, form);
    assert.match(await first.text(), /Call skipped\. You can undo before its original time\./);
    const second = await post(base, token, form);
    assert.match(await second.text(), /No call changed/);

    const rows = await (sql as NonNullable<typeof sql>)`select paused, slot_weekday, next_call_at from callers`;
    assert.equal(rows[0]?.['paused'], false);
    assert.equal(rows[0]?.['slot_weekday'], 2);
    assert.equal((rows[0]?.['next_call_at'] as Date).toISOString(), nextSlotAfter(next, OSLO).toISOString());
  });
});

test('a reviewed move cannot overwrite a newer booking or silently change its proposed date', { skip: skip() }, async () => {
  const phone = '+4790000071';
  const token = await enrolled(phone);
  await store!.record(phone, { at: new Date().toISOString(), durationMs: 300_000, onboardingComplete: true });
  const booked = await sched!.setSlot(phone, OSLO);
  const draft = { scope: 'weekly', day: '4', time: '07:30', version: moveVersion(OSLO, booked) };
  await serving(async base => {
    const review = await post(base, token, { action: 'move-review', ...draft });
    const html = await review.text();
    const proposed = /name="proposed_at" value="([^"]+)"/.exec(html)?.[1];
    assert.ok(proposed);
    assert.equal((await sched!.nextCallFor(phone))?.toISOString(), booked.toISOString(), 'review is read-only');
    const stale = { action: 'move-save', ...draft, proposed_at: proposed };
    const wrongDate = await post(base, token, { ...stale, proposed_at: booked.toISOString() });
    assert.match(await wrongDate.text(), /changed while you were editing/);
    const newer = nextSlotAfter(new Date(), { ...OSLO, weekday: 5 });
    assert.equal(await sched!.moveIfActive(phone, newer), true);
    const outdated = await post(base, token, stale);
    assert.match(await outdated.text(), /changed while you were editing/);
    assert.equal((await sched!.nextCallFor(phone))?.toISOString(), newer.toISOString());
    assert.deepEqual(await sched!.slotFor(phone), OSLO);
  });
});

test('undo skip is account-bound and an old receipt cannot undo a newer skip to the same date', { skip: skip() }, async () => {
  const phone = '+4790000073';
  const token = await enrolled(phone);
  await store!.record(phone, { at: new Date().toISOString(), durationMs: 300_000, onboardingComplete: true });
  const original = await sched!.setSlot(phone, OSLO);
  const otherToken = await enrolled('+4790000074');
  const browserSession = await new Links(sql!).mint(phoneKey(phone), new Date(), 'browser');
  const skip = { action: 'skip', skip_at: original.toISOString() };
  await serving(async (base) => {
    const first = await (await post(base, token, skip)).text();
    const receipt = /name="receipt" value="([^"]+)"/.exec(first)?.[1];
    assert.ok(receipt);
    const undo = { action: 'undo-skip', receipt };
    const rejected = await post(base, otherToken, undo);
    assert.match(await rejected.text(), /can no longer be undone/);
    await store!.upsertProfile(phone, { name: 'Alex' });
    const browser = { cookie: `browser=${browserSession}` };
    const reopened = await (await fetch(`${base}/me`, { headers: browser })).text();
    const reopenedReceipt = /name="receipt" value="([^"]+)"/.exec(reopened)?.[1];
    assert.ok(reopenedReceipt, 'another account entry point still offers undo after a profile edit');
    const restored = await fetch(`${base}/me`, {
      method: 'POST',
      headers: { ...browser, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...undo, receipt: reopenedReceipt }),
    });
    assert.match(await restored.text(), /back on the schedule/);
    assert.deepEqual(await sched!.nextCallFor(phone), original);

    const second = await (await post(base, token, skip)).text();
    const newerReceipt = /name="receipt" value="([^"]+)"/.exec(second)?.[1];
    assert.ok(newerReceipt);
    const newerSkip = await sched!.nextCallFor(phone);
    assert.deepEqual(newerSkip, nextSlotAfter(original, OSLO));
    const stale = await post(base, token, undo);
    assert.match(await stale.text(), /can no longer be undone/);
    assert.deepEqual(await sched!.nextCallFor(phone), newerSkip);
    assert.ok(newerSkip);
    await sched!.moveIfActive(phone, original);
    await sched!.moveIfActive(phone, newerSkip);
    const newerAgain = await (await fetch(`${base}/r/${token}`)).text();
    assert.doesNotMatch(newerAgain, /value="undo-skip"/, 'moving back to the same time does not revive the old skip');
    const withdrawn = await post(base, token, { ...undo, receipt: newerReceipt });
    assert.match(await withdrawn.text(), /can no longer be undone/);
    assert.deepEqual(await sched!.nextCallFor(phone), newerSkip);
  });
});

test('an open undo form from before persistence still works until its original appointment changes', { skip: skip() }, async () => {
  const phone = '+4790000075';
  const token = await enrolled(phone);
  const hash = phoneKey(phone);
  await store!.record(phone, { at: new Date().toISOString(), durationMs: 300_000, onboardingComplete: true });
  const original = await sched!.setSlot(phone, OSLO);
  const next = nextSlotAfter(original, OSLO);
  const [legacy] = await sql!<{ revision: string }[]>`
    update callers set next_call_at = ${next}, updated_at = clock_timestamp()
    where phone_hash = ${hash} returning updated_at::text as revision
  `;
  const receipt = skipReceipt(hash, {
    skippedAt: original.toISOString(), replacementAt: next.toISOString(), cycle: null, revision: legacy!.revision,
  });
  await serving(async base => {
    const restored = await post(base, token, { action: 'undo-skip', receipt });
    assert.match(await restored.text(), /back on the schedule/);
    assert.deepEqual(await sched!.nextCallFor(phone), original);
  });
});

test('legacy later and untargeted skip forms cannot change a returning caller schedule', { skip: skip() }, async () => {
  const phone = '+4790000068';
  const token = await enrolled(phone);
  await (store as NonNullable<typeof store>).record(phone, { at: new Date().toISOString(), durationMs: 300_000, onboardingComplete: true });
  const next = await (sched as Scheduler).setSlot(phone, OSLO);
  await serving(async (base) => {
    const forms: Record<string, string>[] = [{ action: 'later' }, { action: 'skip' }, { action: 'skip', skip_at: 'not-a-date' }];
    for (const form of forms) {
      const res = await post(base, token, form);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /name="time"/);
      assert.equal((await (sched as Scheduler).nextCallFor(phone))?.toISOString(), next.toISOString());
    }
  });
});

test('an expired or forged link says so and does nothing', { skip: skip() }, async () => {
  await enrolled('+4790000064');
  await serving(async (base) => {

  const forged = await fetch(`${base}/r/abcdefghij`);
  assert.equal(forged.status, 410);
  // Against the script line, not a literal: the copy is Eirik's to reword.
  assert.ok((await forged.text()).includes(script.get('page.expired') ?? ''));

  const stale = await new Links(sql as NonNullable<typeof sql>).mint(phoneKey('+4790000064'), new Date(Date.now() - 8 * 24 * 3600_000));
  assert.equal((await fetch(`${base}/r/${stale}`)).status, 410);

  // And nothing moved.
  const rows = await (sql as NonNullable<typeof sql>)`select next_call_at from callers`;
  assert.equal((rows[0]?.['next_call_at'] as Date).getUTCDay(), 2);
  });
});

test('a link for somebody who has since left is not an error page with a stack in it', { skip: skip() }, async () => {
  const token = await new Links(sql as NonNullable<typeof sql>).mint(phoneKey('+4790000065'));
  await serving(async (base) => {
  const res = await fetch(`${base}/r/${token}`);
  assert.equal(res.status, 410);
  assert.ok(!(await res.text()).includes('Error'));
  });
});

/**
 * The address the call is not allowed to ask for.
 *
 * SCRIPT.md §7: an email address is never taken on a call — one real call spent
 * ninety seconds failing to spell a Norwegian name letter by letter down a
 * phone line. So it is collected here, and "here" has to actually work.
 */
test('an address can be set from the link, and a bad one changes nothing', { skip: skip() }, async () => {
  const phone = '+4790000066';
  const token = await enrolled(phone);
  const s_ = store as NonNullable<typeof store>;

  await serving(async (base) => {
    const bad = await post(base, token, { action: 'email', email: 'eirik at example dot com' });
    assert.equal(bad.status, 200);
    assert.match(await bad.text(), /another go/i, 'nothing told them it was refused');
    assert.equal((await s_.load(phone)).email, undefined, 'a rejected address was stored anyway');

    const ok = await post(base, token, { action: 'email', email: 'eirik@example.com' });
    assert.equal(ok.status, 200);
    const body = await ok.text();
    assert.match(body, /Saved/i);
    assert.match(body, /e•••@e•••\.com/, 'the saved address is recognisable');
    assert.ok(!body.includes('eirik@example.com'), 'the full address must not appear in markup');
    assert.equal((await s_.load(phone)).email, 'eirik@example.com');
  });
});

test('setting an address does not disturb the slot', { skip: skip() }, async () => {
  // One page, several controls, one caller record. A form that saved an address
  // by rewriting the row would quietly move somebody's weekly call.
  const phone = '+4790000067';
  const token = await enrolled(phone);
  const before = await (sched as Scheduler).slotFor(phone);

  await serving(async (base) => {
    await post(base, token, { action: 'email', email: 'x@example.com' });
  });

  assert.deepEqual(await (sched as Scheduler).slotFor(phone), before);
});


test('a review hold is visible without promising or resuming a blocked appointment', { skip: skip() }, async () => {
  const phone = '+4790000089';
  const token = await enrolled(phone);
  await sql!`update callers set held_for_review = true where phone_hash = ${phoneKey(phone)}`;
  assert.equal(await sched!.nextEligibleCallFor(phone), undefined);
  assert.equal(await sched!.moveIfActive(phone, new Date(Date.now() + 86400_000)), false);
  await serving(async base => {
    const html = await (await fetch(`${base}/r/${token}`)).text();
    assert.match(html, /Your calls are on hold/);
    assert.match(html, /name="action" value="stop"/);
    assert.doesNotMatch(html, /name="action" value="move-review"/);
    assert.doesNotMatch(html, /Next call Tuesday/);
  });
  await sched!.setPaused(phone, true);
  assert.equal(await sched!.resumeIfEligible(phone), undefined);
  const [state] = await sql!`select paused from callers where phone_hash = ${phoneKey(phone)}`;
  assert.equal(state?.['paused'], true);
});

test('resume explains access ending before the next call and leaves a stale submission paused', { skip: skip() }, async () => {
  const phone = '+4790000090';
  const token = await enrolled(phone);
  const at = new Date(Date.now() + 3 * 86400_000);
  const cutoff = new Date(+at - 86400_000);
  const hash = phoneKey(phone);
  await sql!`update callers set paused = true, billing_status = 'trialing',
    trial_ends_at = ${new Date(+at + 86400_000)}, next_call_at = ${at} where phone_hash = ${hash}`;
  await serving(async base => {
    const eligible = await (await fetch(`${base}/r/${token}`)).text();
    assert.match(eligible, /value="start"/);
    assert.ok(eligible.includes(at.toISOString()));

    await sql!`update callers set trial_ends_at = ${cutoff} where phone_hash = ${hash}`;
    const stale = await (await post(base, token, { action: 'start' })).text();
    assert.match(stale, /Resume didn’t change your schedule/);
    assert.match(stale, /Your free access ends before the next available call/);
    assert.match(stale, /href="#plan">View plan and billing/);
    assert.doesNotMatch(stale, /value="start"/);

    await sql!`update callers set billing_status = 'active', cancel_at_period_end = true, paid_until = ${at} where phone_hash = ${hash}`;
    const nonrenewing = await (await fetch(`${base}/r/${token}`)).text();
    assert.match(nonrenewing, /Your paid access ends before the next available call/);
    assert.doesNotMatch(nonrenewing, /value="start"/);
    const [state] = await sql!`select paused, next_call_at from callers where phone_hash = ${hash}`;
    assert.equal(state?.['paused'], true);
    assert.deepEqual(state?.['next_call_at'], at);
  });
});
