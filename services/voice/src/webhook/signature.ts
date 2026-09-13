import { createHmac, timingSafeEqual } from 'node:crypto';

/** Five minutes, per their documentation. */
const TOLERANCE_MS = 5 * 60_000;

export type Verdict = { ok: true } | { ok: false; why: string };

/**
 * Verify a Speechify webhook signature.
 *
 * `Speechify-Signature: t=<unix seconds>,v0=<hex>`, where the hex is
 * HMAC-SHA256 of `"<t>.<raw body>"` under the endpoint secret.
 *
 * Two things here are easy to get wrong and expensive.
 *
 * The body must be the bytes that arrived. Parsing the JSON and re-serialising
 * it changes key order and whitespace, the HMAC then never matches, and the
 * symptom is every webhook silently failing verification — which looks exactly
 * like an attack and is in fact a framework helpfully parsing the body first.
 *
 * And the timestamp has to be checked. Without it a valid signature stays valid
 * forever, so anyone who captured one delivery can replay it indefinitely: on
 * this endpoint that means re-settling a call, overwriting a commitment, and
 * sending the recap again.
 */
export function verifySignature(
  header: string | undefined,
  rawBody: string | Buffer,
  secret: string,
  now = new Date(),
): Verdict {
  if (!header) return { ok: false, why: 'no signature header' };

  const parts = new Map<string, string>(
    header
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((kv): kv is [string, string] => kv.length === 2),
  );
  const t = parts.get('t');
  const v0 = parts.get('v0');
  if (!t || !v0) return { ok: false, why: 'signature header is missing t or v0' };

  const seconds = Number(t);
  if (!Number.isFinite(seconds)) return { ok: false, why: 't is not a timestamp' };
  if (Math.abs(now.getTime() - seconds * 1000) > TOLERANCE_MS) {
    return { ok: false, why: 'timestamp outside the five-minute window' };
  }

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${t}.`, 'utf8'), body]))
    .digest();

  if (!/^[0-9a-f]*$/i.test(v0)) return { ok: false, why: 'v0 is not hex' };
  const given = Buffer.from(v0, 'hex');
  // Length has to match before timingSafeEqual, which throws otherwise — and a
  // throw is a timing signal of its own.
  if (given.length !== expected.length) return { ok: false, why: 'signature does not match' };
  if (!timingSafeEqual(given, expected)) return { ok: false, why: 'signature does not match' };

  return { ok: true };
}
