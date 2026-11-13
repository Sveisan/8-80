import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { calendarFile, type CalendarEvent } from '../src/calendar/ical.ts';
import { setCalendarInvitations, syncCalendarInvitations, queueCalendarInvitations } from '../src/calendar/invitations.ts';
import { dispatchMessage, dispatchMessages } from '../src/messages/outbox.ts';
import { loadScript } from '../src/script.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { decrypt, encrypt } from '../src/store/crypto.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { openTestDb } from './helpers/db.ts';
import { Pending } from '../src/signup/pending.ts';
import { readSignup } from '../src/signup/form.ts';
import { signupPage } from '../src/signup/page.ts';
import { reschedulePage } from '../src/link/page.ts';
import { accountState } from '../src/link/account.ts';
import { ResendMailer } from '../src/recap/resend.ts';
import { composeExport } from '../src/legal/export.ts';
import { settleConversation } from '../src/loop/settle.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import type { Recap } from '../src/recap/compose.ts';

const script = loadScript();
const now = new Date('2026-11-13T10:00:00Z');
const slot = { weekday: 2, minute: 480, timezone: 'Europe/Oslo' };
const phone = '+4799000891', hash = phoneKey(phone), email = 'calendar@example.com';
const event: CalendarEvent = { uid: 'appointment@8and80', sequence: 0, method: 'REQUEST', at: '2026-11-17T07:00:00.000Z', stamp: now.toISOString(), timezone: slot.timezone };
const opened = await openTestDb('calendar_invitations');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
let sent: Array<{ to: string; body: Recap; key?: string }> = [];
const deps = (): LoopDeps => ({ store: db!.store, scheduler: new Scheduler(db!.sql), script, agent: {} as LoopDeps['agent'],
  sms: { send: async () => ({ id: 'sms' }) },
  mailer: { retryWindowMs: 24 * 3600_000, send: async (to, body, opts) => { sent.push({ to, body, key: opts?.idempotencyKey }); return { id: 'mail' }; } },
});
beforeEach(async () => {
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 6).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  delete process.env['BELIEFS_LIVE_CALLS']; delete process.env['UNBLOCK_LIVE_CALLS'];
  sent = [];
  if (!db) return;
  await db.sql`truncate product_feedback, belief_sessions, unblock_sessions, belief_refund_requests, belief_enrollments, unblock_enrollments, calendar_invitations, message_attempts, message_outbox, callers, call_attempts, links, signups, feedback`;
  await db.store.upsertProfile(phone, { email });
  await new Scheduler(db.sql).setSlot(phone, slot, now);
});
after(async () => db?.close());

test('calendar files describe one private UTC appointment and preserve update/cancellation identity', () => {
  const copy = { title: '8&80 · A little time for yourself', description: "A little room for you and your week, through the eyes of your eight- and eighty-year-old selves.\n\nYou don't need to prepare anything. We'll start with the week as it was." };
  const request = calendarFile({ ...event, ...copy }, '8&80 <calls@example.com>', email);
  const unfolded = request.replace(/\r\n[ \t]/g, '');
  assert.match(unfolded, /SUMMARY:8&80 · A little time for yourself\r\n/);
  assert.match(unfolded, /DESCRIPTION:A little room for you and your week\\, through the eyes of your eight- and eighty-year-old selves\.\\n\\nYou don't need to prepare anything/);
  assert.match(request, /METHOD:REQUEST\r\n/);
  assert.match(request, /DTSTART:20261117T070000Z\r\nDTEND:20261117T071500Z/);
  assert.match(request, /ORGANIZER;CN="8&80":mailto:calls@example.com/);
  assert.match(request, /CLASS:PRIVATE/);
  assert.doesNotMatch(request, /RRULE|phone_hash|commitment|BEGIN:VALARM/);
  const cancel = calendarFile({ ...event, sequence: 1, method: 'CANCEL' }, 'calls@example.com', email);
  assert.match(cancel, /UID:appointment@8and80\r\nSEQUENCE:1/);
  assert.match(cancel, /STATUS:CANCELLED/);
  assert.ok(request.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.match(calendarFile(event, 'calls@example.com', email), /SUMMARY:8&80 call\r\n/, 'previously queued messages retain their original contents');
  assert.throws(() => calendarFile(event, 'calls@example.com\r\nBAD:property', email), /Invalid calendar address/);
});

test('the mail transport sends a calendar MIME attachment with a stable request key', async () => {
  const original = globalThis.fetch;
  let payload: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal((init?.headers as Record<string, string>)['Idempotency-Key'], 'calendar-event');
    return Response.json({ id: 'receipt' });
  };
  try {
    await new ResendMailer('test', '8&80 <calls@example.com>').send(email, { subject: 'Your call', body: 'Call details', parts: [], calendar: event }, { idempotencyKey: 'calendar-event' });
    const attachment = (payload['attachments'] as Array<{ content: string; content_type: string }>)[0]!;
    assert.equal(attachment.content_type, 'text/calendar; charset=utf-8; method=REQUEST');
    assert.match(Buffer.from(attachment.content, 'base64').toString(), /METHOD:REQUEST/);
  } finally { globalThis.fetch = original; }
});

test('signup and account controls offer explicit opt-in, retain it on validation, and reflect saved state', () => {
  assert.match(signupPage(script), /name="calendar" value="yes"\//);
  assert.match(signupPage(script, { values: { calendar: 'yes' } }), /name="calendar" value="yes" checked/);
  assert.match(reschedulePage(slot, script, undefined, email, undefined, { account: { paused: false, billing: 'active', canCall: true, calendarInvitesEnabled: true } }), /value="calendar-off"/);
  assert.match(reschedulePage(slot, script, undefined, undefined, undefined, { account: { paused: false, billing: 'active', canCall: true } }), /value="calendar-on" disabled/);
});

test('the verified signup draft preserves the invitation choice without opting in by default', options, async () => {
  const base = { name: 'Synthetic', phone, email, weekday: '2', time: '08:00', timezone: slot.timezone };
  const read = readSignup(new URLSearchParams(base), now); assert.ok(read.ok); assert.equal(read.signup.calendarInvites, undefined);
  const chosen = readSignup(new URLSearchParams({ ...base, calendar: 'yes' }), now); assert.ok(chosen.ok);
  const pending = new Pending(db!.sql);
  const draft = await pending.begin(chosen.signup, now);
  assert.equal((await pending.draft(draft.id, now))?.calendarInvites, true);
  const verified = await pending.verify(phone, draft.code, now, draft.id); assert.ok(verified.ok);
  assert.equal(verified.signup.calendarInvites, true);
});

test('opt-in and parallel reconciliations create and dispatch exactly one next-call invitation', options, async () => {
  await queueCalendarInvitations(db!.sql, script, now);
  assert.equal((await db!.sql`select * from calendar_invitations`).length, 0);
  const ids = await setCalendarInvitations(db!.sql, hash, true, script, now);
  await Promise.all([syncCalendarInvitations(db!.sql, hash, script, now), syncCalendarInvitations(db!.sql, hash, script, now)]);
  assert.equal((await db!.sql`select * from calendar_invitations`).length, 1);
  assert.equal((await accountState(db!.sql, hash, now))?.calendarInvitesEnabled, true);
  await Promise.all(ids.map(id => dispatchMessage(deps(), id, now)));
  assert.equal(sent.length, 1); assert.equal(sent[0]!.body.calendar?.method, 'REQUEST');
  assert.equal(sent[0]!.body.calendar?.at, event.at);
  const letter = sent[0]!.body;
  assert.equal(letter.calendar?.title, '8&80 · A little time for yourself');
  assert.equal(letter.subject, letter.calendar?.title);
  assert.match(letter.calendar!.description!, /eight- and eighty-year-old selves/);
  assert.match(letter.calendar!.description!, /You don't need to prepare anything\. We'll start with the week as it was\./);
  assert.match(letter.calendar!.description!, /Booking timezone: Europe\/Oslo/);
  assert.match(letter.body, /We'll send an updated invitation if the time changes/);
  assert.equal(letter.body, letter.parts.map(part => part.text).join('\n\n'));
  assert.equal(letter.parts[0]!.role, 'lead');
  assert.equal(letter.parts.at(-1)!.role, 'quiet');
  assert.doesNotMatch(letter.body + letter.calendar?.description, /\{\{|automatically updates|updates your calendar/);
});

test('claiming does not send the following invite; settlement does, and a repeated webhook cannot duplicate it', options, async () => {
  await setCalendarInvitations(db!.sql, hash, true, script, now);
  const due = new Date(event.at);
  const d = deps(); const [claim] = await d.scheduler.claimDue(due); assert.ok(claim);
  await d.scheduler.markPlaced(claim.attemptId, 'calendar-conversation');
  assert.deepEqual(await syncCalendarInvitations(db!.sql, hash, script, due), []);
  assert.equal((await db!.sql`select * from calendar_invitations`).length, 1);
  const payload = { event: 'conversation.completed', conversation_id: 'calendar-conversation', status: 'completed', duration_ms: 700_000,
    messages: [{ role: 'user', content: 'I will run three times this week.' }, { role: 'assistant', content: 'Run three times this week. Is that right?' }, { role: 'user', content: 'Yes.' }, { role: 'assistant', content: 'I will ask how it went next time we talk.' }] };
  const afterCall = new Date(+due + 700_000);
  assert.equal((await settleConversation(payload, d, undefined, afterCall)).handled, true);
  const rows = await db!.sql`select * from calendar_invitations order by scheduled_at`;
  assert.equal(rows.length, 2); assert.equal(rows[0]!['state'], 'finished'); assert.equal(rows[1]!['state'], 'active');
  assert.notEqual(rows[0]!['id'], rows[1]!['id']);
  assert.equal(sent.filter(s => s.body.calendar).length, 1);
  await settleConversation(payload, d, undefined, afterCall);
  assert.equal(sent.filter(s => s.body.calendar).length, 1);
});

test('moving a call updates the same UID and suppresses a stale queued invitation', options, async () => {
  const [stale] = await setCalendarInvitations(db!.sql, hash, true, script, now);
  const at = new Date('2026-11-18T09:00:00Z');
  await new Scheduler(db!.sql).moveIfActive(phone, at);
  const [updated] = await syncCalendarInvitations(db!.sql, hash, script, now);
  assert.equal(await dispatchMessage(deps(), stale!, now), 'suppressed');
  assert.equal(await dispatchMessage(deps(), updated!, now), 'accepted');
  const [row] = await db!.sql`select * from calendar_invitations`;
  assert.equal(sent[0]!.body.calendar?.uid, `${row!['id']}@8and80`);
  assert.equal(sent[0]!.body.calendar?.sequence, 1); assert.equal(sent[0]!.body.calendar?.at, at.toISOString());
});

test('skip, pause, resume and opt-out reconcile the actual schedule without duplicate future events', options, async () => {
  await setCalendarInvitations(db!.sql, hash, true, script, now);
  const sched = new Scheduler(db!.sql);
  await sched.skipCall(phone, now, new Date(event.at));
  await syncCalendarInvitations(db!.sql, hash, script, now);
  const [moved] = await db!.sql`select * from calendar_invitations where state = 'active'`;
  assert.equal(moved!['scheduled_at'].toISOString(), '2026-11-24T07:00:00.000Z');
  await db!.sql`update callers set paused = true where phone_hash = ${hash}`;
  const [cancel] = await syncCalendarInvitations(db!.sql, hash, script, now);
  assert.equal(await dispatchMessage(deps(), cancel!, now), 'accepted');
  assert.equal(sent[0]!.body.calendar?.method, 'CANCEL');
  await sched.resumeIfEligible(phone, now);
  await syncCalendarInvitations(db!.sql, hash, script, now);
  assert.equal((await db!.sql`select * from calendar_invitations where state = 'active'`).length, 1);
  await setCalendarInvitations(db!.sql, hash, false, script, now);
  await syncCalendarInvitations(db!.sql, hash, script, now);
  assert.equal((await db!.sql`select * from calendar_invitations where state = 'active'`).length, 0);
});

test('a changed address cancels at the former address and sends a fresh invitation to the new one', options, async () => {
  const initial = await setCalendarInvitations(db!.sql, hash, true, script, now);
  await dispatchMessage(deps(), initial[0]!, now);
  await db!.store.upsertProfile(phone, { email: 'new@example.com' });
  const ids = await syncCalendarInvitations(db!.sql, hash, script, now);
  for (const id of ids) await dispatchMessage(deps(), id, now);
  assert.deepEqual(sent.map(s => [s.to, s.body.calendar?.method]), [[email, 'REQUEST'], [email, 'CANCEL'], ['new@example.com', 'REQUEST']]);
});

test('STOP, review holds and billing expiry suppress stale requests and cancel future invitations', options, async () => {
  for (const control of ['all_calls_stopped', 'held_for_review', 'paused'] as const) {
    const ids = await setCalendarInvitations(db!.sql, hash, true, script, now);
    await db!.sql`update callers set ${db!.sql(control)} = true where phone_hash = ${hash}`;
    assert.equal(await dispatchMessage(deps(), ids[0]!, now), 'suppressed');
    await syncCalendarInvitations(db!.sql, hash, script, now);
    assert.equal((await db!.sql`select * from calendar_invitations where state = 'active'`).length, 0);
    await db!.sql`update callers set ${db!.sql(control)} = false where phone_hash = ${hash}`;
  }
  const ids = await syncCalendarInvitations(db!.sql, hash, script, now);
  await db!.sql`update callers set billing_status = 'trialing', trial_ends_at = ${new Date('2026-11-14T00:00:00Z')} where phone_hash = ${hash}`;
  assert.equal(await dispatchMessage(deps(), ids[0]!, now), 'suppressed');
  await syncCalendarInvitations(db!.sql, hash, script, now);
  assert.equal((await db!.sql`select * from calendar_invitations where state = 'active'`).length, 0);
});

test('uncertain email acceptance retries the same invitation content and provider key', options, async () => {
  const [id] = await setCalendarInvitations(db!.sql, hash, true, script, now);
  const d = deps(); const send = d.mailer.send; let first = true;
  d.mailer.send = async (...args) => { const receipt = await send(...args); if (first) { first = false; throw new Error('lost receipt'); } return receipt; };
  assert.equal(await dispatchMessage(d, id!, now), 'pending');
  assert.equal(await dispatchMessage(d, id!, new Date(+now + 60_000)), 'accepted');
  assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]);
});

test('explicit additional programme calls get separate invitations; cadence is never expanded', options, async () => {
  process.env['UNBLOCK_LIVE_CALLS'] = 'true';
  const id = randomUUID();
  await db!.sql`insert into unblock_enrollments (id,checkout_reference,phone_hash,programme_enc,consent_version,consent_at,standing,timezone,next_weekly_at,next_light_at,weekly_weekday,weekly_minute,light_weekdays,light_minute)
    values (${id},${id},${hash},${encrypt(JSON.stringify({ schema: 1, revision: 0, state: 'active', openingHeld: true, weeksHeld: 0, chapterCalls: 4 }))},'test',${now},'active','Europe/Oslo',${new Date('2026-11-18T08:00:00Z')},${new Date('2026-11-19T08:00:00Z')},3,540,${[4]}::integer[],540)`;
  await setCalendarInvitations(db!.sql, hash, true, script, now);
  assert.equal((await db!.sql`select * from calendar_invitations where state = 'active'`).length, 3);
  await dispatchMessages(deps(), now);
  assert.equal(sent.length, 3);
});

test('calendar data is included in export and removed with the account', options, async () => {
  await setCalendarInvitations(db!.sql, hash, true, script, now);
  const [row] = await db!.sql`select * from calendar_invitations`;
  assert.notEqual(row!['recipient_enc'], email); assert.equal(decrypt(row!['recipient_enc']), email);
  const exported = await composeExport(db!.store, phone, script);
  assert.match(exported!.body, /calendarInvitations/);
  await db!.store.forget(phone);
  assert.equal((await db!.sql`select * from calendar_invitations`).length, 0);
});
