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

/** Features that need every variable or none, and what says somebody meant to enable one. */
export const FEATURE_GROUPS: { label: string; trigger: string[]; needs: string[] }[] = [
  {
    label: 'the recap email',
    trigger: ['RESEND_API_KEY', 'RECAP_FROM_ADDRESS'],
    needs: ['RESEND_API_KEY', 'RECAP_FROM_ADDRESS'],
  },
  {
    // Only SMS_FROM_NUMBER triggers it: the account SID and auth token are
    // shared with the telephony adapter, and holding those without an SMS
    // number is what using Twilio for voice alone looks like.
    label: 'the missed-call text',
    trigger: ['SMS_FROM_NUMBER'],
    needs: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SMS_FROM_NUMBER'],
  },
];

export function preflight(env: NodeJS.ProcessEnv = process.env): Check[] {
  const checks: Check[] = [];
  // Read the provider from the env we were handed, not from module-level
  // config — otherwise this function silently ignores its own argument.
  const provider = env['TELEPHONY_PROVIDER'] ?? config.telephonyProvider;
  const voice = env['VOICE_PROVIDER'] ?? config.voiceProvider;

  const need = (key: string, why: string) => {
    const v = env[key];
    checks.push({ ok: Boolean(v), label: key, detail: v ? undefined : why });
    return v;
  };

  // Two entirely different deployments share this file. The product runs on
  // Speechify and a control plane; the self-hosted Grok path is what `stress`
  // exercises. Checking both at once means every run reports half a dozen
  // failures for a stack that is not in use, and a report that cries wolf is a
  // report nobody reads — which is how a real misconfiguration hides.
  if (voice === 'speechify') {
    checks.push({ ok: true, label: 'voice: speechify' });
    need('SPEECHIFY_API_KEY', 'Speechify console → API keys.');
    need('SPEECHIFY_AGENT_ID', 'The returning-call agent. In its URL, or ⋯ → Copy ID.');
    need(
      'SPEECHIFY_WEBHOOK_SECRET',
      "Channels → Webhook, per agent. Comma-separate one per agent, or every delivery is refused and the call is never written down.",
    );
    need('DATABASE_URL', 'Nothing runs without it — the scheduler, the calls, all of it.');
    need('DATA_ENCRYPTION_KEY', 'No commitment is stored. Generate with: openssl rand -base64 32');
    need('PUBLIC_URL', 'Where a reschedule link points. Without it no missed-call text is sent at all.');

    const callerId = env['SPEECHIFY_CALLER_ID_NUMBER'];
    if (callerId && !E164.test(callerId)) {
      checks.push({
        ok: false,
        label: 'SPEECHIFY_CALLER_ID_NUMBER is not E.164',
        detail: 'Must start with + and contain digits only — no spaces, dashes or brackets.',
      });
    }
    if (!env['SPEECHIFY_FIRST_CALL_AGENT_ID']) {
      checks.push({
        ok: true,
        label: 'no separate first-call agent',
        detail: 'First calls will get the returning-call prompt, which opens "Hello again" at somebody who has never been called.',
      });
    }
    checkFeatureGroups(env, checks);
    checkOneNumber(env, checks);
    return checks;
  }

  checks.push({ ok: true, label: `voice: ${voice}` });
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

  checkOneNumber(env, checks);

  checkFeatureGroups(env, checks);

  return checks;
}

/**
 * The caller sees ONE number or the product lies to them. sms.missed opens
 * "Rang just now", and setup.save_number asks them to save the number "I'm on"
 * so they know it is us on the Tuesday — both are false if the text arrives
 * from somewhere else, and a link from an unfamiliar number is the exact shape
 * of a phishing message. One number that does voice and SMS, or no text at all.
 */
function checkOneNumber(env: NodeJS.ProcessEnv, checks: Check[]): void {
  const voiceFrom = env['SPEECHIFY_CALLER_ID_NUMBER'];
  const smsFrom = env['SMS_FROM_NUMBER'];
  if (voiceFrom && smsFrom && voiceFrom !== smsFrom) {
    checks.push({
      ok: false,
      label: 'the call and the text come from different numbers',
      detail:
        'SPEECHIFY_CALLER_ID_NUMBER and SMS_FROM_NUMBER must be the same number. ' +
        'The missed-call text says "Rang just now" and carries a link; from an unfamiliar number that reads as phishing, ' +
        'and the first call asks them to save the number so they recognise it next week.',
    });
  } else if (voiceFrom && !smsFrom) {
    checks.push({
      ok: true,
      label: 'no SMS number',
      detail: 'Texts are written to disk, not sent. A missed call costs somebody their week with no way back in.',
    });
  } else if (smsFrom && !voiceFrom) {
    // The mismatch is just as real when one side is the platform's default:
    // the caller still gets a call from one number and a text from another.
    checks.push({
      ok: false,
      label: 'the text has a number and the call does not',
      detail:
        'SMS_FROM_NUMBER is set but SPEECHIFY_CALLER_ID_NUMBER is not, so calls arrive from whatever the platform picks ' +
        'and the text arrives from somewhere else entirely — which is the shape the missed-call text must never have.',
    });
  }

  // A text to a Norwegian phone from a number that is not Norwegian.
  if (smsFrom && !smsFrom.startsWith('+47')) {
    checks.push({
      ok: true,
      label: `SMS from ${smsFrom.slice(0, 3)}… to Norwegian numbers`,
      detail:
        'Fine for testing the plumbing, wrong for callers: it may be filtered or rewritten by their operator, ' +
        'and replying costs them international rates — which is why SCRIPT.md §13 sends a link and not a conversation.',
    });
  }
}

/**
 * Half a feature configured is the dangerous state: invisible in a
 * per-variable list, since every name reads as present or absent on its own,
 * and until recently it took down the tick that places the calls.
 */
function checkFeatureGroups(env: NodeJS.ProcessEnv, checks: Check[]): void {
  for (const group of FEATURE_GROUPS) {
    if (!group.trigger.some((k) => env[k])) continue;
    const missing = group.needs.filter((k) => !env[k]);
    if (missing.length) {
      checks.push({
        ok: false,
        label: `${group.label} is half configured`,
        detail: `Missing: ${missing.join(', ')}`,
      });
    }
  }
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
