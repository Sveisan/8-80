import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { controlPlane } from '../../services/voice/src/control.ts';
import { openTestDb } from '../../services/voice/test/helpers/db.ts';
import { Scheduler } from '../../services/voice/src/schedule/scheduler.ts';
import { loadScript } from '../../services/voice/src/script.ts';
import { phoneKey } from '../../services/voice/src/store/postgres.ts';
import { Links } from '../../services/voice/src/link/token.ts';
import { encrypt } from '../../services/voice/src/store/crypto.ts';
import { SendFailure } from '../../services/voice/src/messages/types.ts';
import type { LoopDeps } from '../../services/voice/src/loop/deps.ts';
import type { Subscription } from '../../services/voice/src/billing/gateway.ts';
import type { Recap } from '../../services/voice/src/recap/compose.ts';
import { queueEncouragement } from '../../services/voice/src/encouragement/runtime.ts';
import { dispatchMessages } from '../../services/voice/src/messages/outbox.ts';
import { UnblockRepository } from '../../services/voice/src/unblock/repository.ts';
import { applyCommand, finishCall } from '../../services/voice/src/unblock/model.ts';

if (!process.env['TEST_DATABASE_URL']) throw new Error('Browser journeys require an explicit TEST_DATABASE_URL.');
const unblock = process.env['DESIGN_UNBLOCK_TEST'] === '1';
const port = Number(process.env['DESIGN_JOURNEY_PORT'] ?? (unblock ? 8792 : 8791));
Object.assign(process.env, {
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64'), PUBLIC_URL: `${unblock ? 'https' : 'http'}://127.0.0.1:${port}`,
  SIGNUP_OPEN: '1', TWILIO_ACCOUNT_SID: 'design-test', TWILIO_AUTH_TOKEN: 'design-test',
  SMS_FROM_NUMBER: '+4790008800', SPEECHIFY_CALLER_ID_NUMBER: '+4790008800',
  SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID: 'synthetic-female-first', SPEECHIFY_FEMALE_AGENT_ID: 'synthetic-female-weekly',
  BILLING_PROVIDER: 'stripe', STRIPE_WEBHOOK_SECRET: 'design-test-webhook',
});
if (unblock) Object.assign(process.env, {
  UNBLOCK_ENABLED: 'true', UNBLOCK_LIVE_CALLS: 'false', UNBLOCK_SAFETY_APPROVED: 'true', UNBLOCK_SCRIPTS_APPROVED: 'true', UNBLOCK_AGENTS_VERIFIED: 'true',
  UNBLOCK_PRICE_VERIFIED: 'true', UNBLOCK_PRICE_LABEL: '249 kr / month (synthetic)', UNBLOCK_PRODUCT_ID: 'synthetic-unblock',
  UNBLOCK_CHECKOUT_URL: 'https://buy.stripe.com/synthetic', UNBLOCK_TOOL_SECRET: 'synthetic-unblock-browser-secret'.repeat(2),
  UNBLOCK_OPENING_AGENT_ID: 'synthetic-unblock-opening', UNBLOCK_WEEKLY_AGENT_ID: 'synthetic-unblock-regular', UNBLOCK_LIGHT_AGENT_ID: 'synthetic-unblock-light',
  UNBLOCK_SUPPORT_HOURS: 'Monday–Friday, 09:00–17:00 Europe/Oslo (synthetic)', UNBLOCK_COVERAGE_START: '09:00', UNBLOCK_COVERAGE_END: '17:00', UNBLOCK_COVERAGE_DAYS: '1,2,3,4,5',
  SUPPORT_EMAIL: 'support@example.com', OPERATOR_PHONE: '+4790008899', UNBLOCK_OPERATOR_PHONE: '+4790008899', SPEECHIFY_API_KEY: 'synthetic', SPEECHIFY_WEBHOOK_SECRET: 'synthetic', STRIPE_SECRET_KEY: 'synthetic',
});
const opened = await openTestDb(unblock ? 'design_browser_unblock' : 'design_browser');
if (typeof opened === 'string') throw new Error(opened);
const db = opened;
const script = loadScript();
const texts: { to: string; body: string }[] = [];
const emails: Recap[] = [];
let failSms = false, failMail = false;
let subscription: Subscription;
let cancellations = 0;
const reset = async (): Promise<void> => {
  const tables = await db.sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = current_schema() and tablename <> '__drizzle_migrations'`;
  const safe = tables.map(row => row.tablename).filter(name => /^[a-z_]+$/.test(name));
  await db.sql.unsafe(`truncate ${safe.map(name => `"${name}"`).join(',')} cascade`);
  texts.length = 0; emails.length = 0; failSms = failMail = false; cancellations = 0;
  process.env['ENCOURAGEMENT_PILOT_HASHES']='';process.env['ENCOURAGEMENT_READY']='0';process.env['ENCOURAGEMENT_PHONE_TEST_PASSED']='0';
  subscription = { provider: 'stripe', subscriptionId: 'sub_design', customerId: 'cus_design', standing: 'active',
    status: 'active', event: 'customer.subscription.updated', cancelAtPeriodEnd: false, endsAt: new Date(Date.now() + 20 * 86400_000).toISOString(),
    ...(unblock ? { productIds: ['synthetic-unblock'] } : {}) };
};
await reset();
const deps: LoopDeps = {
  store: db.store, scheduler: new Scheduler(db.sql), script,
  agent: { placeCall: async () => { throw new Error('A design test must never place a call.'); }, conversation: async () => ({}) } as unknown as LoopDeps['agent'],
  sms: { send: async (to, body) => { if (failSms) throw new SendFailure('permanent', 'synthetic SMS failure'); texts.push({ to, body }); return { id: `synthetic-sms-${texts.length}` }; } },
  mailer: { send: async (_to, email) => { if (failMail) throw new Error('synthetic mail failure'); emails.push(email); return { id: 'synthetic-email' }; } },
  billing: {
    subscription: async () => ({ ...subscription }),
    cancel: async () => { if (!subscription.cancelAtPeriodEnd) cancellations++; subscription.cancelAtPeriodEnd = true; return { ...subscription }; },
    portal: async () => 'https://billing.stripe.com/p/synthetic-session',
  },
};
const app = controlPlane(deps, 'synthetic-webhook');
// A separate TLS fixture exercises the production HTTPS/secure-cookie readiness
// boundary. Certificates and all credentials are ephemeral synthetic test data.
const tlsDir = unblock ? mkdtempSync(join(tmpdir(), '8and80-unblock-browser-tls-')) : undefined;
if (tlsDir) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(tlsDir, 'key.pem'), '-out', join(tlsDir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
const server = tlsDir ? createSecureServer({ key: readFileSync(join(tlsDir, 'key.pem')), cert: readFileSync(join(tlsDir, 'cert.pem')) }) : createServer();
server.on('request', (req, res) => { void (async () => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (!url.pathname.startsWith('/__test/')) { app.emit('request', req, res); return; }
  if (req.headers['x-design-fixture-key'] !== 'synthetic-design-fixture') { res.writeHead(403); res.end(); return; }
  const reply = (data: unknown): void => { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const form = JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, string | boolean>;
  if (url.pathname === '/__test/reset') { await reset(); reply({ ok: true }); return; }
  if (url.pathname === '/__test/code') {
    const phone = String(form.phone);
    const code = texts.filter(message => message.to === phone).at(-1)?.body.match(/\b\d{6}\b/)?.[0];
    reply({ code }); return;
  }
  if (url.pathname === '/__test/failure') { failSms = form.sms === true; failMail = form.mail === true; reply({ ok: true }); return; }
  if (url.pathname === '/__test/encouragement-delivery') {
    const phone=String(form.phone??'+4792000001'),hash=phoneKey(phone);
    if(process.env['ENCOURAGEMENT_PILOT_HASHES']!==hash)throw Error('Synthetic pilot only.');
    const now=new Date();await db.sql`update encouragement_preferences set next_at=${now} where phone_hash=${hash} and enabled and not paused`;
    await queueEncouragement(deps,now);await dispatchMessages(deps,now);reply({mockTexts:texts.filter(t=>t.to===phone).length});return;
  }
  if (url.pathname === '/__test/seed') {
    const phone = String(form.phone ?? '+4792000001'), hash = phoneKey(phone);
    if(form.encouragement===true)process.env['ENCOURAGEMENT_PILOT_HASHES']=hash;
    await db.store.upsertProfile(phone, { name: 'Alex', email: 'alex@example.com' });
    const tomorrow = new Date(Date.now() + 86400_000);
    const weekday = new Date(tomorrow.toLocaleString('en-US', { timeZone: 'Europe/Oslo' })).getDay();
    await deps.scheduler.setSlot(phone, { weekday, minute: 17 * 60 + 30, timezone: 'Europe/Oslo' });
    await db.sql`update callers set onboarding = 'complete', call_number = 2,
      last_commitment_enc = ${encrypt('Make room for an evening without plans.')}, goals_enc = ${encrypt('Spend more time outside.')},
      billing_status = ${form.paid ? 'active' : 'trialing'}, trial_ends_at = now() + interval '20 days', paused = ${form.paused === true},
      billing_provider = ${form.paid ? 'stripe' : null}, ls_subscription_id = ${form.paid ? 'sub_design' : null},
      ls_customer_id = ${form.paid ? 'cus_design' : null}, paid_until = ${form.paid ? new Date(subscription.endsAt!) : null}
      where phone_hash = ${hash}`;
    const link = await new Links(db.sql).mint(hash);
    reply({ phone, hash, link: `/r/${link}` }); return;
  }
  if (url.pathname === '/__test/expire') {
    const hash = phoneKey(String(form.phone));
    await db.sql`update signups set expires_at = now() - interval '1 minute' where phone_hash = ${hash}`;
    await db.sql`update access_codes set expires_at = now() - interval '1 minute' where phone_hash = ${hash}`;
    reply({ ok: true }); return;
  }
  if (url.pathname === '/__test/state') {
    const hash = phoneKey(String(form.phone));
    const [caller] = await db.sql`select paused, billing_status, cancel_at_period_end, slot_weekday, slot_minute, onboarding, calendar_invites_enabled, next_call_at from callers where phone_hash = ${hash}`;
    const memory = await db.store.load(String(form.phone));
    reply({ caller, goals: memory.goals, commitment: memory.lastCommitment, cancellations, calendarEmails: emails.flatMap(email => email.calendar ? [email.calendar] : []) }); return;
  }
  if (url.pathname === '/__test/unblock-state') {
    const loaded = await new UnblockRepository(db.sql).load(phoneKey(String(form.phone)));
    reply(loaded ? { enrollment: loaded.enrollment, programme: loaded.programme, cancellations } : { enrollment: null }); return;
  }
  if (url.pathname === '/__test/unblock-opening') {
    const hash = phoneKey(String(form.phone));
    const loaded = await new UnblockRepository(db.sql).load(hash);
    if (!loaded) throw Error('Synthetic Unblock account missing.');
    let p = applyCommand(loaded.programme, { type: 'wish', text: 'Learn to sail a small boat', why: 'Time outside matters to me' }, 'synthetic-wish');
    p = applyCommand(p, { type: 'step', week: 1, text: 'Ask a neighbour about a sailing course' }, 'synthetic-step');
    p = finishCall(p, 'opening', 0);
    await db.sql`update unblock_enrollments set programme_enc=${encrypt(JSON.stringify(p))},revision=${p.revision},opening_at=null where phone_hash=${hash}`;
    reply({ ok: true }); return;
  }
  if (url.pathname === '/__test/revision') {
    const hash = phoneKey(String(form.phone));
    await db.sql`update callers set goals_enc = ${encrypt('A newer goal saved elsewhere.')} where phone_hash = ${hash}`;
    reply({ ok: true }); return;
  }
  if (url.pathname === '/__test/digest') { reply({ schema: createHash('sha256').update('design-browser-fixtures-v1').digest('hex') }); return; }
  res.writeHead(404); res.end();
})().catch(error => { console.error(error); if (!res.headersSent) res.writeHead(500); res.end('Synthetic fixture failed.'); }); });
server.listen(port, '127.0.0.1', () => console.log(`Design journey server: http://127.0.0.1:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { server.closeAllConnections(); server.close(() => { void db.close().then(() => { if (tlsDir) rmSync(tlsDir, { recursive: true, force: true }); process.exit(0); }); }); });
