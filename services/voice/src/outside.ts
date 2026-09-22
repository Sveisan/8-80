import { config } from './config.ts';

/**
 * What the outside world thinks it is pointing at.
 *
 * Every expensive failure on this project has been of one shape: a console
 * somewhere disagreeing with the code, silently, with nothing local to look
 * at. The webhook secret that belonged to the other agent. The deploy that was
 * six commits behind. The caller ID the platform picked because we did not.
 * The messaging service whose inbound URL quietly overrides the number's.
 *
 * None of those are visible from inside the process. This asks the outside.
 *
 * Read-only, short timeouts, and every probe returns a line rather than
 * throwing — a diagnostic that hangs on a dead host is worse than no
 * diagnostic, because you wait for it.
 */
/**
 * Which URL Twilio will actually POST an inbound text to.
 *
 * A number in a messaging service is handled by the service, and the number's
 * own webhook is ignored — unless `use_inbound_webhook_on_number` is set, in
 * which case it is the other way round. The number page keeps displaying its
 * webhook either way, which is how somebody sets it correctly, sees it set
 * correctly, and still has every STOP swallowed.
 */
export function effectiveInbound(input: { onNumber: boolean; serviceUrl: string; numberUrl: string }): string {
  return input.onNumber ? input.numberUrl : input.serviceUrl;
}

export interface Probe {
  ok: boolean;
  label: string;
  detail?: string;
}

const TIMEOUT_MS = 4_000;

async function get(url: string, init: RequestInit = {}): Promise<Response | Error> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return e as Error;
  }
}

/** The public URL, as the internet sees it rather than as the config claims. */
export async function probePublicUrl(): Promise<Probe[]> {
  const base = config.link.publicUrl().replace(/\/+$/, '');
  if (!base) return [{ ok: false, label: 'PUBLIC_URL is unset', detail: 'Nothing below can be checked without it.' }];

  const out: Probe[] = [];
  const health = await get(`${base}/health`);
  if (health instanceof Error) {
    out.push({
      ok: false,
      label: `${base}/health is unreachable`,
      detail: `${health.message}. DNS, TLS, the reverse proxy or the service itself — in that order.`,
    });
    // Everything below goes through the same hop. One failure is enough.
    return out;
  }
  out.push({ ok: health.ok, label: `${base}/health`, detail: health.ok ? undefined : `HTTP ${health.status}` });

  const mark = await get(`${base}/mark.png`);
  if (mark instanceof Error || !mark.ok) {
    out.push({
      ok: false,
      label: 'the recap letterhead is not being served',
      detail: 'The email falls back to the wordmark alone, which is by design — but this should work.',
    });
  } else {
    const type = mark.headers.get('content-type') ?? '';
    out.push({
      ok: type.startsWith('image/png'),
      label: `${base}/mark.png`,
      detail: type.startsWith('image/png') ? undefined : `served as ${type || 'nothing'}, not image/png`,
    });
  }

  const front = await get(`${base}/`);
  const open = config.signup.open();
  if (front instanceof Error) out.push({ ok: false, label: 'the front page is unreachable', detail: front.message });
  else if (open) out.push({ ok: front.ok, label: 'the sign-up page is open', detail: front.ok ? undefined : `HTTP ${front.status}` });
  else out.push({ ok: true, label: 'the sign-up page is closed', detail: 'SIGNUP_OPEN is not 1, or the Twilio block is incomplete.' });

  return out;
}

/**
 * Twilio's view of our number.
 *
 * The check that matters is the messaging service: once a number belongs to
 * one, the service's inbound URL overrides the number's own, and the number
 * page goes on displaying the webhook it is no longer using. Somebody can set
 * it correctly, see it set correctly, and still have every STOP swallowed.
 */
export async function probeTwilio(): Promise<Probe[]> {
  const sid = process.env['TWILIO_ACCOUNT_SID'];
  const token = process.env['TWILIO_AUTH_TOKEN'];
  const from = process.env['SMS_FROM_NUMBER'];
  if (!sid || !token || !from) return [{ ok: false, label: 'Twilio is not configured', detail: 'No texts are sent at all.' }];

  const want = `${config.link.publicUrl().replace(/\/+$/, '')}/webhooks/sms`;
  const auth = { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` };
  const out: Probe[] = [];

  const numbers = await get(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`,
    { headers: auth },
  );
  if (numbers instanceof Error || !numbers.ok) {
    return [{ ok: false, label: 'Twilio would not answer', detail: numbers instanceof Error ? numbers.message : `HTTP ${numbers.status}` }];
  }
  const found = (await numbers.json()) as { incoming_phone_numbers?: { sms_url?: string; messaging_service_sid?: string }[] };
  const number = found.incoming_phone_numbers?.[0];
  if (!number) {
    return [{ ok: false, label: `${from} is not on this Twilio account`, detail: 'SMS_FROM_NUMBER and the credentials disagree.' }];
  }

  const service = number.messaging_service_sid;
  if (!service) {
    const url = number.sms_url ?? '';
    out.push({
      ok: url === want,
      label: url === want ? 'the number posts inbound texts to us' : 'the number posts inbound texts elsewhere',
      detail: url === want ? undefined : `It points at ${url || 'nothing'}. Should be ${want}.`,
    });
    return out;
  }

  out.push({ ok: true, label: `the number belongs to messaging service ${service}` });
  const svc = await get(`https://messaging.twilio.com/v1/Services/${service}`, { headers: auth });
  if (svc instanceof Error || !svc.ok) {
    out.push({ ok: false, label: 'that service could not be read', detail: svc instanceof Error ? svc.message : `HTTP ${svc.status}` });
    return out;
  }
  const body = (await svc.json()) as { inbound_request_url?: string; friendly_name?: string; use_inbound_webhook_on_number?: boolean };
  const onNumber = body.use_inbound_webhook_on_number === true;
  const effective = effectiveInbound({
    onNumber,
    serviceUrl: body.inbound_request_url ?? '',
    numberUrl: number.sms_url ?? '',
  });

  out.push({
    ok: effective === want,
    label: effective === want ? 'inbound texts reach us' : 'inbound texts do NOT reach us',
    detail:
      effective === want
        ? `via ${onNumber ? 'the number' : `the service (${body.friendly_name ?? service})`}`
        : `The ${onNumber ? 'number' : 'service'} points at ${effective || 'nothing'}. It should be ${want}. ` +
          'Until it does, STOP and every reply go to whatever is there instead.',
  });
  return out;
}
