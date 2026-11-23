import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { controlPlane } from '../src/control.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { dispatchMessages } from '../src/messages/outbox.ts';
import type { Recap } from '../src/recap/compose.ts';
import { letterHtml } from '../src/recap/letter.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { loadScript } from '../src/script.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { invitationLinks } from '../src/weekly/intro-pilot.ts';
import { armPilotFollowup, queuePilotFollowups, rememberPilotOptIn } from '../src/weekly/pilot-followup.ts';
import { pilotFollowupFrom, pilotFollowupLetter, pilotFollowupVersion } from '../src/weekly/pilot-followup-copy.ts';

const opened = await openTestDb('weekly_pilot_followup');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const hour = 3600_000;
const slot = { weekday: 4, minute: 990, timezone: 'Europe/Oslo' };
const completed = new Date('2026-11-19T15:45:00Z');
const usualAppointment = new Date('2026-11-26T15:30:00Z');
const base = 'https://8and80.example';
const recipients: { to: string; letter: Recap }[] = [];
const texts: string[] = [];

Object.assign(process.env, {
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'), PUBLIC_URL: base,
  SIGNUP_OPEN: '1', WEEKLY_PILOT_INTAKE: '1', WEEKLY_FRIEND_INVITES: '1', WEEKLY_PILOT_INVITE_SECRET: 'synthetic-invitation-token-for-pilot-testing',
  TWILIO_ACCOUNT_SID: 'fixture', TWILIO_AUTH_TOKEN: 'fixture', SMS_FROM_NUMBER: '+4794710999',
  BILLING_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'fixture', STRIPE_WEBHOOK_SECRET: 'fixture',
  STRIPE_WEEKLY_PILOT_PRICE_ID: 'price_fixture', STRIPE_WEEKLY_PILOT_COUPON_ID: 'intro_fixture',
  RECAP_FROM_ADDRESS: pilotFollowupFrom,
});
after(async () => { await db?.close(); });

const deps = (): LoopDeps => ({
  store: db!.store, scheduler: new Scheduler(db!.sql), script: loadScript(),
  sms: { send: async (_to, body) => { texts.push(body); } },
  agent: { placeCall: async () => { throw Error('Unexpected call'); } } as unknown as LoopDeps['agent'],
  mailer: { send: async (to, letter) => { recipients.push({ to, letter }); } },
});

async function withServer(fn: (url: string) => Promise<void>) {
  const server = controlPlane(deps(), 'test');
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn('http://127.0.0.1:' + (server.address() as AddressInfo).port); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

const post = (values: Record<string, string>) => ({ method: 'POST', body: new URLSearchParams(values), redirect: 'manual' as const });

test('only verified paid-pilot signups can give optional consent, and approval gates the form', options, async () => {
  const invite = new URL(invitationLinks(base).pilot).searchParams.get('invite')!;
  await withServer(async url => {
    assert.doesNotMatch(await (await fetch(`${url}/start?invite=${invite}`)).text(), /name="pilot_followup"/);
    process.env['WEEKLY_PILOT_FOLLOWUP_APPROVED'] = pilotFollowupVersion;
    const html = await (await fetch(`${url}/start?invite=${invite}`)).text();
    assert.match(html, /name="pilot_followup" value="yes"\/>/);
    assert.match(html, /Keep what matters in view/);
    assert.match(html, /up to two notes after my free call.*subscribe to 8&amp;80 or explore Unblock.*Optional\. Unsubscribe anytime\./);
    const friendPath = new URL(invitationLinks(base)['friend-1']);
    assert.doesNotMatch(await (await fetch(url + friendPath.pathname + friendPath.search)).text(), /name="pilot_followup"/);
    const phone = '+4794710000';
    const res = await fetch(`${url}/start`, post({ phone, name: 'Fixture', email: 'opt-in@example.com',
      weekday: '4', time: '16:30', timezone: slot.timezone, invite, pilot_followup: 'yes' }));
    const draft = /name="draft" value="([^"]+)"/.exec(await res.text())?.[1];
    const code = texts[0]?.match(/\b\d{6}\b/)?.[0];
    assert.ok(draft && code);
    assert.equal((await db!.sql`select * from weekly_pilot_followups`).length, 0);
    const edit = await fetch(`${url}/start/edit`, post({ draft }));
    assert.match(await edit.text(), /name="pilot_followup" value="yes" checked/);
    assert.equal((await fetch(`${url}/start/verify`, post({ phone, draft, code }))).status, 303);
    const [consent] = await db!.sql`select consent_version,next_slot_at from weekly_pilot_followups where phone_hash=${phoneKey(phone)}`;
    assert.equal(consent?.['consent_version'], pilotFollowupVersion);
    assert.equal(consent?.['next_slot_at'], null);

    const noThanks = '+4794710100';
    const withoutConsent = await fetch(`${url}/start`, post({ phone: noThanks, email: 'no-thanks@example.com',
      weekday: '4', time: '16:30', timezone: slot.timezone, invite }));
    const otherDraft = /name="draft" value="([^"]+)"/.exec(await withoutConsent.text())?.[1];
    const otherCode = texts.at(-1)?.match(/\b\d{6}\b/)?.[0];
    assert.ok(otherDraft && otherCode);
    assert.equal((await fetch(`${url}/start/verify`, post({ phone: noThanks, draft: otherDraft, code: otherCode }))).status, 303);
    assert.equal((await db!.sql`select 1 from weekly_pilot_followups where phone_hash=${phoneKey(noThanks)}`).length, 0);
  });
});

test('send at most one email per window and suppress paid, revoked and changed recipients at dispatch', options, async () => {
  process.env['WEEKLY_PILOT_FOLLOWUP_APPROVED'] = pilotFollowupVersion;
  const sql = db!.sql;
  const prepare = async (idx: number) => {
    const phone = `+479471000${idx}`;
    await db!.store.upsertProfile(phone, { email: `pilot-${idx}@example.com`, ...(idx === 1 ? { name: 'Maja Example' } : {}) });
    const hash = phoneKey(phone);
    await sql`update callers set weekly_offer='pilot', weekly_free_calls_used=1, billing_status='ended' where phone_hash=${hash}`;
    await rememberPilotOptIn(sql, hash, completed);
    await armPilotFollowup(sql, hash, slot, completed);
    const [row] = await sql`select id,next_slot_at from weekly_pilot_followups where phone_hash=${hash}`;
    assert.equal(+row!['next_slot_at'], +usualAppointment);
    return { hash, id: String(row!['id']), phone };
  };
  const regular = await prepare(1);
  const pays = await prepare(2);
  const withdraws = await prepare(3);
  const changesEmail = await prepare(4);
  const before = new Date(+usualAppointment - 24 * hour);
  const afterSlot = new Date(+usualAppointment + 48 * hour);

  await queuePilotFollowups(sql, new Date(+before - 1000));
  assert.equal((await sql`select * from message_outbox where kind='pilot-followup'`).length, 0);
  await Promise.all([queuePilotFollowups(sql, before), queuePilotFollowups(sql, before)]);
  await sql`update callers set billing_status='active',ls_subscription_id='sub_fixture' where phone_hash=${pays.hash}`;
  await db!.store.upsertProfile(changesEmail.phone, { email: 'updated@example.com' });

  await withServer(async url => {
    const unsubscribe = `${url}/pilot-followup/${withdraws.id}/unsubscribe`;
    assert.equal((await fetch(unsubscribe)).status, 200);
    const [beforePost] = await sql`select revoked_at from weekly_pilot_followups where id=${withdraws.id}`;
    assert.equal(beforePost?.['revoked_at'], null);
    assert.equal((await fetch(unsubscribe, post({ 'List-Unsubscribe': 'One-Click' }))).status, 200);
  });

  await dispatchMessages(deps(), before);
  assert.deepEqual(recipients.map(mail => mail.to), ['pilot-1@example.com']);
  const first = recipients[0]!.letter;
  assert.match(first.body, /^Hi Maja,/);
  assert.match(first.body, /Continue with 8&80[^\n]+\n\nNOK 189/);
  assert.match(first.body, /NOK 189.*NOK 249/);
  const rendered = letterHtml(first);
  assert.match(rendered, /https:\/\/8and80\.example\/unblock/);
  assert.match(rendered, /Unsubscribe from these follow-ups/);
  assert.ok(rendered.indexOf('Continue with 8&amp;80') < rendered.indexOf('NOK 189'));
  assert.ok(rendered.indexOf('The 8&amp;80 team') < rendered.indexOf('Read about Unblock'));
  await queuePilotFollowups(sql, afterSlot);
  await dispatchMessages(deps(), afterSlot);
  await queuePilotFollowups(sql, new Date(+afterSlot + 60000));
  await dispatchMessages(deps(), new Date(+afterSlot + 60000));
  assert.deepEqual(recipients.map(mail => mail.to), ['pilot-1@example.com', 'pilot-1@example.com']);
  assert.equal(recipients[1]!.letter.action?.url, `${base}/pilot-followup/${regular.id}/feedback`);
  assert.doesNotMatch(recipients[1]!.letter.body, /NOK|improve the pilot/);
  assert.match(pilotFollowupLetter('after', base, regular.id).body, /^Hi,/);

  await withServer(async url => {
    const feedbackPage = `${url}/pilot-followup/${regular.id}/feedback`;
    assert.match(await (await fetch(feedbackPage)).text(), /What would help you take the next step\?/);
    assert.equal((await fetch(feedbackPage, post({ reason: '1' }))).status, 200);
  });
  const [feedback] = await sql`select feedback from weekly_pilot_followups where id=${regular.id}`;
  assert.equal(feedback?.['feedback'], 'A smaller first step');
  assert.equal(await db!.store.forget(regular.phone), true);
  assert.equal((await sql`select 1 from weekly_pilot_followups where id=${regular.id}`).length, 0);
});
