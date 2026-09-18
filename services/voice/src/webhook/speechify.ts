import type { CallTranscript, Turn } from '../call/outcome.ts';

export type WebhookEvent = 'conversation.completed' | 'conversation.failed';

export class UnreadablePayload extends Error {}

/** Their word for who spoke, mapped to ours. Anything else is an error. */
const SPEAKERS: Record<string, Turn['speaker']> = {
  agent: 'agent',
  assistant: 'agent',
  bot: 'agent',
  user: 'caller',
  caller: 'caller',
  human: 'caller',
  customer: 'caller',
};

/**
 * A `conversation.completed` or `conversation.failed` payload, as a transcript.
 *
 * Everything here refuses rather than guesses, for one reason. `settle()` reads
 * "the agent spoke and the caller never did" as a call nobody could hear — a
 * real failure worth acting on. A mapper that quietly dropped turns it did not
 * recognise, or returned an empty list when the field was named something else,
 * would manufacture that diagnosis out of its own confusion: the call would be
 * recorded as silent, the commitment discarded, and the week lost, all with a
 * green webhook and no error anywhere.
 *
 * So an unreadable payload throws. A webhook that 500s gets retried and
 * noticed; a webhook that succeeds with the wrong answer does not.
 */
export function toTranscript(payload: unknown): CallTranscript {
  if (!payload || typeof payload !== 'object') throw new UnreadablePayload('payload is not an object');
  const p = payload as Record<string, unknown>;

  const conversationId = str(p['conversation_id']) ?? str(p['conversationId']);
  if (!conversationId) throw new UnreadablePayload('no conversation_id');

  const raw = p['messages'] ?? p['transcript'] ?? (p['conversation'] as Record<string, unknown>)?.['messages'];
  if (!Array.isArray(raw)) throw new UnreadablePayload('no messages array');

  const turns: Turn[] = raw.map((m, i) => {
    if (!m || typeof m !== 'object') throw new UnreadablePayload(`message ${i} is not an object`);
    const msg = m as Record<string, unknown>;
    const role = (str(msg['role']) ?? str(msg['speaker']) ?? '').toLowerCase();
    const speaker = SPEAKERS[role];
    if (!speaker) throw new UnreadablePayload(`message ${i} has an unknown role ${JSON.stringify(role)}`);
    const text = str(msg['content']) ?? str(msg['text']) ?? '';
    return { speaker, text };
  });

  const durationMs = num(p['duration_ms']) ?? num(p['durationMs']);
  if (durationMs === undefined) throw new UnreadablePayload('no duration_ms');

  const endedReason = str(p['end_reason']) ?? str(p['ended_reason']) ?? str(p['status']);

  return { providerCallId: conversationId, turns, durationMs, ...(endedReason ? { endedReason } : {}) };
}

/**
 * The event name, when it is one we act on.
 *
 * Speechify sends it in the `Speechify-Event` header, which is where this looks
 * first. Reading only `payload.event` is what silently discarded the first
 * three real calls: the delivery verified, parsed and returned 200 with
 * `handled: false`, so every log and every dashboard said the webhook was fine
 * while nothing was ever written down. The body keys are kept as a fallback
 * because a header is easy to lose through a proxy and costs nothing to check.
 */
export function eventOf(payload: unknown, header?: string): WebhookEvent | undefined {
  const p = payload as Record<string, unknown> | null;
  const name =
    str(header) ?? str(p?.['event']) ?? str(p?.['type']) ?? str(p?.['event_type']) ?? str(p?.['eventType']);
  return name === 'conversation.completed' || name === 'conversation.failed' ? name : undefined;
}

/**
 * The field NAMES in a payload, two levels deep, with types instead of values.
 *
 * A payload we cannot read is the one thing we most need to see and the one
 * thing we must never log: it is a transcript. Names and types are neither —
 * "no conversation_id" says the field is missing, and this says where the
 * fields actually are, without a word anybody said appearing in a log file.
 */
export function shapeOf(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `array[${value.length}]${value.length && depth < 2 ? `<${shapeOf(value[0], depth + 1)}>` : ''}`;
  }
  if (typeof value !== 'object') return typeof value;
  if (depth >= 2) return 'object';
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${k}:${shapeOf(v, depth + 1)}`,
  );
  return `{${entries.join(',')}}`;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
