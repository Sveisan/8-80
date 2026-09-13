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

/** The event name, when it is one we act on. */
export function eventOf(payload: unknown): WebhookEvent | undefined {
  const name = str((payload as Record<string, unknown> | null)?.['event']);
  return name === 'conversation.completed' || name === 'conversation.failed' ? name : undefined;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
