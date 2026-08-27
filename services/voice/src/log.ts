/**
 * Logging with scrubbing that is on by default.
 *
 * Transcript content, phone numbers and email addresses must never reach stdout
 * or any error tracker. This is enforced here rather than at each call site,
 * because the call site is where it will be forgotten. test/log.test.ts proves it.
 */

const E164 = /\+?\d[\d\s().-]{6,}\d/g;
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

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
  if (typeof value === 'string') {
    return value.replace(E164, '[number]').replace(EMAIL, '[email]');
  }
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
