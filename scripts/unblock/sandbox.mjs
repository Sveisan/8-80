import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, lstatSync, chmodSync } from 'node:fs';
import { resolve, dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import process from 'node:process';
import console from 'node:console';
import postgres from 'postgres';
import { parse } from 'dotenv';
import { checkSandbox } from './guards.mjs';

process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const state = resolve(root, 'output/unblock-sandbox');
mkdirSync(state, { recursive: true, mode: 0o700 });
if (lstatSync(state).isSymbolicLink()) throw Error('Sandbox state must be a private directory, not a symbolic link.');
chmodSync(state, 0o700);
if (existsSync(join(root, '.env'))) throw Error('Use a clean isolated checkout without a production .env.');
const privateFile = join(state, 'private.env');
if (existsSync(privateFile) && (lstatSync(privateFile).isSymbolicLink() || (lstatSync(privateFile).mode & 0o077) !== 0)) throw Error('Sandbox credentials must be a private file with mode 600.');
const payment = existsSync(privateFile) ? parse(readFileSync(privateFile, 'utf8')) : {};
const allowedPaymentKeys = new Set(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'UNBLOCK_PRODUCT_ID', 'UNBLOCK_CHECKOUT_URL', 'UNBLOCK_PRICE_LABEL']);
if (Object.keys(payment).some(key => !allowedPaymentKeys.has(key))) throw Error('Unrecognised sandbox payment setting.');
const databaseUrl = 'postgres://postgres@127.0.0.1:55586/unblock_sandbox', publicUrl = 'https://127.0.0.1:8793';
checkSandbox({ databaseUrl, publicUrl, stripeKey: payment.STRIPE_SECRET_KEY, checkout: payment.UNBLOCK_CHECKOUT_URL });
const lock = join(state, 'runner.lock');
if (existsSync(lock)) {
  const old = Number(readFileSync(lock, 'utf8'));
  let running = false; try { process.kill(old, 0); running = true; } catch { /* stale owned lock */ }
  if (running || !Number.isInteger(old) || old < 2) throw Error('An existing sandbox runner must be stopped first.');
  unlinkSync(lock);
}
const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
const pgBin = [process.env.DESIGN_PG_BIN, ...String(process.env.PATH).split(delimiter), '/opt/homebrew/opt/postgresql@18/bin'].filter(Boolean).find(p => existsSync(join(p, 'initdb')) && existsSync(join(p, 'pg_ctl')));
const data = join(state, 'postgres');
let pgStarted = false, app, listener, stopping = false;
const cleanEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const command = (bin, args, options = {}) => {
  const result = spawnSync(bin, args, { cwd: root, encoding: 'utf8', env: cleanEnv, ...options });
  if (result.status !== 0) throw Error('Sandbox command failed: ' + bin + ' (see private runtime files).');
  return result.stdout;
};
const freePort = async port => { const server = createServer(); await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); }); await new Promise(ok => server.close(ok)); };
async function stop() {
  if (stopping) return; stopping = true;
  listener?.kill('SIGTERM');
  if (app && app.exitCode === null) { app.kill('SIGTERM'); await new Promise(ok => app.once('exit', ok)); }
  if (pgStarted) spawnSync(join(pgBin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void stop().then(() => process.exit(0)); });
try {
  if (!pgBin) throw Error('Set DESIGN_PG_BIN to a local Postgres installation.');
  await freePort(55586); await freePort(8793);
  if (!existsSync(join(data, 'PG_VERSION'))) {
    command(join(pgBin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--locale=C', '--encoding=UTF8']);
    writeFileSync(join(state, 'database.marker'), 'Private Unblock sandbox; no production data.\n');
  } else if (!existsSync(join(state, 'database.marker'))) throw Error('Unrecognised database directory.');
  command(join(pgBin, 'pg_ctl'), ['-D', data, '-o', `-h 127.0.0.1 -p 55586 -k ${state} -c shared_buffers=16MB -c max_connections=20`, '-l', join(state, 'postgres.log'), '-w', 'start']);
  pgStarted = true;
  const admin = postgres('postgres://postgres@127.0.0.1:55586/postgres', { max: 1 });
  try { if (!(await admin`select 1 from pg_database where datname='unblock_sandbox'`).length) await admin.unsafe('create database unblock_sandbox'); } finally { await admin.end(); }
  const keyPath = join(state, 'fixture.key');
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('base64url'), { mode: 0o600 });
  const encryptionPath = join(state, 'encryption.key');
  if (!existsSync(encryptionPath)) writeFileSync(encryptionPath, randomBytes(32).toString('base64'), { mode: 0o600 });
  if (!existsSync(join(state, 'cert.pem'))) command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(state, 'key.pem'), '-out', join(state, 'cert.pem'), '-days', '30', '-subj', '/CN=127.0.0.1']);
  const env = { ...cleanEnv, DATABASE_URL: databaseUrl, SANDBOX_DATABASE_URL: databaseUrl, SANDBOX_STATE_DIR: state, PUBLIC_URL: publicUrl, DATA_ENCRYPTION_KEY: readFileSync(encryptionPath, 'utf8'), ...payment };
  app = spawn(process.execPath, ['--import', 'tsx', 'scripts/unblock/server.ts'], { cwd: root, env, stdio: 'inherit' });
  app.once('exit', code => { if (!stopping) { process.exitCode = code || 1; void stop(); } });
  if (payment.STRIPE_SECRET_KEY && payment.STRIPE_WEBHOOK_SECRET) {
    const binary = join(state, 'bin/stripe');
    if (!existsSync(binary)) throw Error('Install the official Stripe CLI in output/unblock-sandbox/bin first.');
    const log = openSync(join(state, 'stripe-listener.log'), 'a', 0o600);
    listener = spawn(binary, ['listen', '--events', 'checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed', '--forward-to', publicUrl + '/webhooks/payments', '--skip-verify'], { cwd: root, env: { ...cleanEnv, STRIPE_API_KEY: payment.STRIPE_SECRET_KEY, STRIPE_NO_AUTO_UPDATE: '1' }, stdio: ['ignore', log, log] });
    closeSync(log);
    listener.once('exit', () => { if (!stopping) { console.error('Stripe listener stopped; payments are not verified.'); process.exitCode = 1; void stop(); } });
  }
  console.log('Private sandbox: ' + publicUrl + '/unblock');
  console.log(payment.STRIPE_SECRET_KEY ? 'Stripe test credentials loaded; verify listener readiness before checkout.' : 'Stripe is not connected yet. Payment and enrolment stay unavailable.');
  console.log('Only synthetic messages are captured here. Phone calls cannot be placed.');
} catch (error) { console.error(error.message); process.exitCode = 1; await stop(); }
