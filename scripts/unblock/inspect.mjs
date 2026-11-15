import { request } from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { syntheticPhone } from './guards.mjs';

const action = process.argv[2], phone = process.argv[3] || '+4792300901';
process.umask(0o077);
if (!['code', 'state', 'hooks'].includes(action) || !syntheticPhone(phone)) throw Error('Use code, state or hooks with a synthetic sandbox phone.');
const root = 'output/unblock-sandbox';
const result = await new Promise((ok, fail) => {
  const body = JSON.stringify({ phone });
  const req = request({ hostname: '127.0.0.1', port: 8793, path: '/__sandbox/' + action, method: 'POST', rejectUnauthorized: false,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-sandbox-key': readFileSync(root + '/fixture.key', 'utf8') } }, res => {
    let text = ''; res.on('data', part => { text += part; }); res.on('end', () => { if (res.statusCode !== 200) { fail(Error('Local sandbox inspection failed.')); return; } try { ok(JSON.parse(text)); } catch { fail(Error('Invalid local sandbox response.')); } });
  }); req.on('error', fail); req.end(body);
});
if (action === 'code') {
  if (!/^\d{6}$/.test(result.code || '')) throw Error('No captured synthetic code.');
  writeFileSync(root + '/code.private.txt', result.code, { mode: 0o600 });
  console.log('Captured synthetic verification code prepared; no real SMS was read.');
} else if (action === 'state') {
  writeFileSync(root + '/state.private.json', JSON.stringify(result, null, 2), { mode: 0o600 });
  const e = result.enrollment;
  console.log(JSON.stringify(e ? { standing: e.standing, callsPerMonth: e.calls_per_month, timezone: e.timezone, lightDays: e.light_weekdays, openingAt: e.opening_at, nextRegularAt: e.next_weekly_at, cancelling: e.cancel_at_period_end, programme: result.programme.state } : { enrollment: null }));
} else {
  console.log(JSON.stringify({ webhookResults: result }));
}
