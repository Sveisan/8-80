import { createServer } from 'node:http';
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

if (!process.env['TEST_DATABASE_URL']) throw new Error('Browser journeys require an explicit TEST_DATABASE_URL.');
const port = 8791;
Object.assign(process.env, {
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString('base64'), PUBLIC_URL: `http://127.0.0.1:${port}`,
  SIGNUP_OPEN: '1', TWILIO_ACCOUNT_SID: 'design-test', TWILIO_AUTH_TOKEN: 'design-test',
  SMS_FROM_NUMBER: '+4790008800', SPEECHIFY_CALLER_ID_NUMBER: '+4790008800',
  SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID: 'synthetic-female-first', SPEECHIFY_FEMALE_AGENT_ID: 'synthetic-female-weekly',
  BILLING_PROVIDER: 'stripe', STRIPE_WEBHOOK_SECRET: 'design-test-webhook',
});
const opened = await openTestDb('design_browser');
if (typeof opened === 'string') throw new Error(opened);
const db = opened;
const script = loadScript();
const texts: { to: string; body: string }[] = [];
let failSms = false, failMail = false;
let subscription: Subscription;
let cancellations = 0;
const reset = async (): Promise<void> => {
  const tables = await db.sql<{ tablename: string }[]>`select tablename from pg_tables where schemaname = current_schema() and tablename <> '__drizzle_migrations'`;
  const safe = tables.map(row => row.tablename).filter(name => /^[a-z_]+$/.test(name));
  await db.sql.unsafe(`truncate ${safe.map(name => `"${name}"`).join(',')} cascade`);
  texts.length = 0; failSms = failMail = false; cancellations = 0;
  subscription = { provider: 'stripe', subscriptionId: 'sub_design', customerId: 'cus_design', standing: 'active',
    status: 'active', event: 'customer.subscription.updated', cancelAtPeriodEnd: false, endsAt: new Date(Date.now() + 20 * 86400_000).toISOString() };
};
await reset();
const deps: LoopDeps = {
  store: db.store, scheduler: new Scheduler(db.sql), script,
  agent: { placeCall: async () => { throw new Error('A design test must never place a call.'); }, conversation: async () => ({}) } as unknown as LoopDeps['agent'],
  sms: { send: async (to, body) => { if (failSms) throw new SendFailure('permanent', 'synthetic SMS failure'); texts.push({ to, body }); return { id: `synthetic-sms-${texts.length}` }; } },
  mailer: { send: async () => { if (failMail) throw new Error('synthetic mail failure'); return { id: 'synthetic-email' }; } },
  billing: {
    subscription: async () => ({ ...subscription }),
    cancel: async () => { if (!subscription.cancelAtPeriodEnd) cancellations++; subscription.cancelAtPeriodEnd = true; return { ...subscription }; },
    portal: async () => 'https://billing.stripe.com/p/synthetic-session',
  },
};
const app = controlPlane(deps, 'synthetic-webhook');
const server = createServer((req, res) => { void (async () => {
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
  if (url.pathname === '/__test/seed') {
    const phone = String(form.phone ?? '+4792000001'), hash = phoneKey(phone);
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
    const [caller] = await db.sql`select paused, billing_status, cancel_at_period_end, slot_weekday, slot_minute, onboarding from callers where phone_hash = ${hash}`;
    const memory = await db.store.load(String(form.phone));
    reply({ caller, goals: memory.goals, commitment: memory.lastCommitment, cancellations }); return;
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
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { server.closeAllConnections(); server.close(() => { void db.close().then(() => process.exit(0)); }); });
