/**
 * Logging with scrubbing that is on by default.
 *
 * Transcript content, phone numbers and email addresses must never reach stdout
 * or any error tracker. This is enforced here rather than at each call site,
 * because the call site is where it will be forgotten. test/log.test.ts proves it.
 */

const E164 = /\+?\d[\d\s().-]{6,}\d/g;
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * A vendor's opaque id, protected from the phone-number rule.
 *
 * `81e3d461be9037461c73342` contains a run of digits long enough to look like
 * a telephone number, so the scrubber rewrote it as `81e3d461be[number]c73342`
 * — destroying the only identifier Speechify's support can look up, in exactly
 * the log line written to make a failure escalatable. It happened twice before
 * anybody noticed, because a mangled id still looks like an id.
 *
 * Sixteen to sixty-four hex characters with at least one letter among them. No
 * phone number is that long and none contains an a-f, so nothing about the
 * privacy rule is weakened: this cannot match something it was meant to catch.
 */
const OPAQUE_ID = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{16,64}\b/gi;
const MARK = '\u0000';

/** Scrub a string, leaving vendor ids intact. */
function scrubString(text: string): string {
  const kept: string[] = [];
  const masked = text.replace(OPAQUE_ID, (id) => {
    kept.push(id);
    return `${MARK}${kept.length - 1}${MARK}`;
  });
  return masked
    .replace(E164, '[number]')
    .replace(EMAIL, '[email]')
    .replace(new RegExp(`${MARK}(\\d+)${MARK}`, 'g'), (_, i: string) => kept[Number(i)] ?? '');
}

/** Keys whose values are transcript content and are never logged, at any depth. */
const NEVER_LOG = new Set([
  'transcript',
  'text',
  'utterance',
  'instructions',
  'summary',
  'commitment',
  'delta',
  'audio',
  'content',
]);

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = NEVER_LOG.has(k) ? `[redacted:${k}]` : scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function log(event: string, fields: Record<string, unknown> = {}): void {
  const line = { t: new Date().toISOString(), event, ...(scrub(fields) as object) };
  console.log(JSON.stringify(line));
}
