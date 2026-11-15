import { createServer } from 'node:https';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config, repoRoot } from '../../services/voice/src/config.ts';
import { controlPlane } from '../../services/voice/src/control.ts';
import { PostgresStore, phoneKey } from '../../services/voice/src/store/postgres.ts';
import { applyMigrations } from '../../services/voice/src/store/migrate.ts';
import { Scheduler } from '../../services/voice/src/schedule/scheduler.ts';
import { loadScript } from '../../services/voice/src/script.ts';
import { UnblockRepository } from '../../services/voice/src/unblock/repository.ts';
import type { LoopDeps } from '../../services/voice/src/loop/deps.ts';
// @ts-expect-error The guards are also executable by plain Node before tsx starts.
import { checkSandbox, syntheticPhone } from './guards.mjs';

if (existsSync(join(repoRoot, '.env'))) throw Error('A sandbox must not load a production .env.');
const state = process.env['SANDBOX_STATE_DIR'];
if (!state) throw Error('Use the sandbox launcher.');
const checked = checkSandbox({ databaseUrl: process.env['SANDBOX_DATABASE_URL'], publicUrl: process.env['PUBLIC_URL'], stripeKey: process.env['STRIPE_SECRET_KEY'], checkout: process.env['UNBLOCK_CHECKOUT_URL'] });
const stripeConnected = !!(process.env['STRIPE_SECRET_KEY'] && process.env['STRIPE_WEBHOOK_SECRET'] && process.env['UNBLOCK_PRODUCT_ID'] && process.env['UNBLOCK_CHECKOUT_URL']);
// Synthetic readiness only, inside this separate process. No production settings are read or written.
Object.assign(process.env, {
  UNBLOCK_ENABLED: 'true', UNBLOCK_LIVE_CALLS: 'false', UNBLOCK_SAFETY_APPROVED: 'true', UNBLOCK_SCRIPTS_APPROVED: 'true', UNBLOCK_AGENTS_VERIFIED: 'true',
  UNBLOCK_PRICE_VERIFIED: stripeConnected ? 'true' : 'false', UNBLOCK_PRICE_LABEL: process.env['UNBLOCK_PRICE_LABEL'] || '249 kr / month (test only)',
  UNBLOCK_TOOL_SECRET: randomBytes(32).toString('base64url'), UNBLOCK_OPENING_AGENT_ID: 'sandbox-no-calls-opening', UNBLOCK_WEEKLY_AGENT_ID: 'sandbox-no-calls-regular', UNBLOCK_LIGHT_AGENT_ID: 'sandbox-no-calls-light',
  UNBLOCK_SUPPORT_HOURS: 'Sandbox only', UNBLOCK_COVERAGE_START: '00:00', UNBLOCK_COVERAGE_END: '24:00',
  TWILIO_ACCOUNT_SID: 'synthetic-no-provider', TWILIO_AUTH_TOKEN: 'synthetic-no-provider', SMS_FROM_NUMBER: '+4790008800',
  SPEECHIFY_API_KEY: 'synthetic-no-provider', SPEECHIFY_WEBHOOK_SECRET: 'synthetic-no-provider',
  OPERATOR_PHONE: '+4792300999', SUPPORT_EMAIL: 'sandbox@example.invalid', BILLING_PROVIDER: 'stripe',
  SIGNUP_OPEN: '0', PRODUCT_FEEDBACK_ENABLED: '0', GOOGLE_CALENDAR_READY: '0', ENCOURAGEMENT_READY: '0',
});
await applyMigrations(checked.databaseUrl);
const store = new PostgresStore(checked.databaseUrl);
const texts: { to: string; body: string }[] = [];
const fixtureKey = readFileSync(join(state, 'fixture.key'), 'utf8');
const hooks: { type: string; status: number; at: string }[] = [];
const deps: LoopDeps = {
  store, scheduler: new Scheduler(store.raw), script: loadScript(),
  agent: { placeCall: async () => { throw Error('Sandbox calls are blocked.'); }, conversation: async () => { throw Error('Sandbox calls are blocked.'); } } as unknown as LoopDeps['agent'],
  sms: { send: async (to, body) => { if (!syntheticPhone(to)) throw Error('Use a synthetic sandbox test phone.'); texts.push({ to, body }); if (texts.length > 100) texts.shift(); return { id: 'sandbox-captured-' + texts.length }; } },
  mailer: { send: async () => { throw Error('Sandbox email delivery is blocked.'); } },
  // No fake billing gateway: production code calls Stripe using the test key.
};
const app = controlPlane(deps, 'synthetic-no-provider');
const server = createServer({ key: readFileSync(join(state, 'key.pem')), cert: readFileSync(join(state, 'cert.pem')) }, (req, res) => { void (async () => {
  const url = new URL(req.url ?? '/', checked.publicUrl);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (url.pathname.startsWith('/__sandbox/')) {
    if (url.pathname === '/__sandbox/health') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ private: true, stripeConnected, liveCalls: false, capturedSmsOnly: true })); return; }
    if (req.method !== 'POST' || req.headers['x-sandbox-key'] !== fixtureKey) { res.writeHead(403); res.end(); return; }
    let body = ''; for await (const chunk of req) { body += String(chunk); if (body.length > 1024) { res.writeHead(413); res.end(); return; } }
    const input = JSON.parse(body || '{}') as { phone?: string };
    if (url.pathname === '/__sandbox/hooks') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(hooks)); return; }
    if (!input.phone || !syntheticPhone(input.phone)) { res.writeHead(400); res.end(); return; }
    res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    if (url.pathname === '/__sandbox/code') { res.end(JSON.stringify({ code: texts.filter(t => t.to === input.phone).at(-1)?.body.match(/\b\d{6}\b/)?.[0] })); return; }
    if (url.pathname === '/__sandbox/state') {
      const loaded = await new UnblockRepository(store.raw).load(phoneKey(input.phone));
      res.end(JSON.stringify(loaded ? { enrollment: loaded.enrollment, programme: loaded.programme } : { enrollment: null })); return;
    }
    res.writeHead(404); res.end(); return;
  }
  if (url.pathname === '/webhooks/payments') {
    let content = '';
    req.on('data', chunk => { if (content.length < 262144) content += String(chunk); });
    res.once('finish', () => {
      let type = 'unreadable'; try { type = String(JSON.parse(content).type || 'unknown'); } catch { /* rejected request */ }
      hooks.push({ type, status: res.statusCode, at: new Date().toISOString() }); if (hooks.length > 100) hooks.shift();
      writeFileSync(join(state, 'webhook-proof.json'), JSON.stringify(hooks, null, 2), { mode: 0o600 });
    });
  }
  const end = res.end.bind(res);
  res.end = ((chunk: unknown, ...args: unknown[]) => {
    if (typeof chunk === 'string' && String(res.getHeader('content-type')).includes('text/html')) chunk = chunk.replace(/<body([^>]*)>/, '<body$1><aside style="padding:12px;text-align:center;background:#fff0ba;color:#182e24;font:14px system-ui">Private sandbox · test payments only · messages captured locally · phone calls blocked</aside>');
    return (end as (...values: unknown[]) => typeof res)(chunk, ...args);
  }) as typeof res.end;
  app.emit('request', req, res);
})().catch(() => { if (!res.headersSent) res.writeHead(500); res.end('Private sandbox request failed.'); }); });
server.listen(Number(new URL(checked.publicUrl).port), '127.0.0.1', () => console.log('Private HTTPS sandbox ready; Stripe connected: ' + stripeConnected));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { server.closeAllConnections(); server.close(() => { void store.close().then(() => process.exit(0)); }); });
void config; // Environment is loaded once by the shared application module.
