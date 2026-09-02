/**
 * Everything that can be checked without touching the network, checked before
 * a call is attempted. A failed dial tells you almost nothing; this tells you
 * exactly which field is wrong.
 */
import { config } from './config.ts';

export interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

const E164 = /^\+[1-9]\d{6,14}$/;

export function preflight(env: NodeJS.ProcessEnv = process.env): Check[] {
  const checks: Check[] = [];
  // Read the provider from the env we were handed, not from module-level
  // config — otherwise this function silently ignores its own argument.
  const provider = env['TELEPHONY_PROVIDER'] ?? config.telephonyProvider;

  const need = (key: string, why: string) => {
    const v = env[key];
    checks.push({ ok: Boolean(v), label: key, detail: v ? undefined : why });
    return v;
  };

  checks.push({ ok: true, label: `telephony: ${provider}`, detail: undefined });

  if (provider === 'twilio') {
    const sid = need('TWILIO_ACCOUNT_SID', 'Console home. Starts with AC.');
    need('TWILIO_AUTH_TOKEN', 'Console home, next to the SID. Never commit it.');
    if (sid && !sid.startsWith('AC')) {
      checks.push({ ok: false, label: 'TWILIO_ACCOUNT_SID looks wrong', detail: 'Should start with AC. A PN… value is a phone number SID, not an account SID.' });
    }
  } else {
    need('TELNYX_API_KEY', 'Telnyx console → API keys.');
    need('TELNYX_CONNECTION_ID', 'The Call Control application id.');
  }

  need('XAI_API_KEY', 'xAI console.');

  for (const key of ['OUTBOUND_CALLER_NUMBER', 'STRESS_TEST_TARGET_NUMBER']) {
    const v = env[key];
    if (!v) {
      checks.push({ ok: false, label: key, detail: 'Required, in E.164 (+47…, +1…).' });
    } else if (!E164.test(v)) {
      checks.push({ ok: false, label: `${key} is not E.164`, detail: 'Must start with + and contain digits only — no spaces, dashes or brackets.' });
    } else {
      checks.push({ ok: true, label: key });
    }
  }

  const ws = env['VOICE_WS_PUBLIC_URL'];
  if (!ws) {
    checks.push({ ok: false, label: 'VOICE_WS_PUBLIC_URL', detail: 'Public wss:// URL the carrier can reach. A tunnel is fine while developing.' });
  } else if (!/^wss:\/\//.test(ws)) {
    checks.push({ ok: false, label: 'VOICE_WS_PUBLIC_URL must be wss://', detail: `Got "${ws.split('://')[0]}://". Carriers will not connect to ws:// or https://.` });
  } else if (/localhost|127\.0\.0\.1|0\.0\.0\.0|::1/.test(ws)) {
    checks.push({ ok: false, label: 'VOICE_WS_PUBLIC_URL is local', detail: 'The carrier connects to this from the internet — localhost is unreachable to it. Use a tunnel or the VPS hostname.' });
  } else {
    checks.push({ ok: true, label: 'VOICE_WS_PUBLIC_URL' });
  }

  const target = env['STRESS_TEST_TARGET_NUMBER'];
  const from = env['OUTBOUND_CALLER_NUMBER'];
  if (provider === 'twilio' && target && from && !target.startsWith(from.slice(0, 2))) {
    checks.push({
      ok: true,
      label: 'international call',
      detail: `${from.slice(0, 3)}… → ${target.slice(0, 3)}…  Enable the destination country under Voice geo permissions, or the dial fails with no useful error. Messaging geo permissions is a different setting and does not affect this.`,
    });
  }

  return checks;
}

export function report(checks: Check[]): boolean {
  const failed = checks.filter((c) => !c.ok);
  for (const c of checks) {
    console.log(`  ${c.ok ? '·' : '✕'} ${c.label}${c.detail ? `\n      ${c.detail}` : ''}`);
  }
  console.log('');
  if (failed.length) console.log(`  ${failed.length} thing(s) to fix before dialling.\n`);
  return failed.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('\nPreflight — checked locally, nothing dialled\n');
  process.exit(report(preflight()) ? 0 : 1);
}
