import { createHmac, timingSafeEqual } from 'node:crypto';
import { obj, str } from '../billing/types.ts';
import { PracticeError, wording } from '../beliefs/model.ts';
import { containsWords, explicitAgreement, hasAgreement, normalise } from '../beliefs/protocol.ts';
import { applyCommand, ARC_WEEKS, callHeld, currentWish, localDay, parseBlockKind, parseDays, parseOutcome, parseTime, VOICE_COMMANDS, type CallKind, type Command, type Programme } from './model.ts';

export type Kind = CallKind;
export interface Receipt { id: string; callerText: string; command: Command; }
export interface Snapshot { revision: number; initial: Programme; programme: Programme; receipts: Receipt[]; coverage: Record<string, 'done'>; }

export const UNBLOCK_TOOL_NAME = 'capture_unblock';
export const UNBLOCK_TOOL_PATH = '/unblock/tool';
/** Flat provider parameters for `capture_unblock`. The provisioning CLI verifies the attached tool against this list. */
export const UNBLOCK_TOOL_PARAMS = [
  { name: 'session_id', type: 'string', required: true, description: 'Private call session ID from {{session_id}}. Never spoken.' },
  { name: 'session_token', type: 'string', required: true, description: 'Private call credential from {{session_token}}. Never spoken.' },
  { name: 'event_id', type: 'string', required: true, description: 'New stable unique ID for each logical save; reuse on retry.' },
  { name: 'caller_text', type: 'string', required: true, description: 'Consecutive caller turns joined in order, verbatim, no agent wording.' },
  { name: 'command', type: 'string', required: false, enum: VOICE_COMMANDS, description: 'Omit for a plain caller-utterance safety check.' },
  { name: 'confirmed', type: 'boolean', required: false, description: 'True only when the latest caller turn explicitly agreed to the read-back.' },
  { name: 'text', type: 'string', required: false, description: 'Caller words: wish, block, step, light moment or closing reflection.' },
  { name: 'why_text', type: 'string', required: false, description: 'wish: why it matters, in caller words.' },
  { name: 'kind', type: 'string', required: false, enum: ['limit', 'prediction', 'unsure'], description: 'block: limit or prediction only if the caller agreed with that label; otherwise unsure.' },
  { name: 'week', type: 'integer', required: false, description: 'step: the week the step is for. step_outcome: the week of the step. Checked against the server.' },
  { name: 'outcome', type: 'string', required: false, enum: ['done', 'partly', 'not', 'changed'], description: 'step_outcome only.' },
  { name: 'outcome_text', type: 'string', required: false, description: 'step_outcome: what happened, in caller words.' },
  { name: 'carry_text', type: 'string', required: false, description: 'closing: the one thing to carry forward, in caller words.' },
  { name: 'days', type: 'string', required: false, description: 'light_schedule: comma-separated weekdays. Empty means no light calls.' },
  { name: 'time', type: 'string', required: false, description: 'light_schedule: local time HH:MM.' },
] as const;

export function sessionToken(id: string, secret: string): string {
  if (secret.length < 32) throw new PracticeError('tools_unavailable');
  return createHmac('sha256', secret).update('unblock:session:' + id).digest('base64url');
}
export function verifySessionToken(id: string, token: string, secret: string): boolean {
  if (secret.length < 32) return false;
  const want = Buffer.from(sessionToken(id, secret)), got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}
/** Speechify's webhook worker may wrap the model arguments; the per-call HMAC still authorises everything. */
export function unblockWebhookArguments(input: unknown): unknown {
  const v = obj(input);
  if (!v || !Object.hasOwn(v, 'arguments')) return input;
  const args = obj(v['arguments']);
  if (v['tool_name'] !== UNBLOCK_TOOL_NAME || !args || ['session_id', 'session_token', 'command', 'event_id', 'caller_text'].some(k => Object.hasOwn(v, k))) throw new PracticeError('unauthorized');
  return args;
}

const DAY_WORDS = [['sun', 'søn'], ['mon', 'man'], ['tue', 'tir'], ['wed', 'ons'], ['thu', 'tor'], ['fri', 'fre'], ['sat', 'lør']];
function quoted(text: string, value: unknown): string {
  const words = wording(value); if (!containsWords(text, words)) throw new PracticeError('caller_words_required'); return words;
}
const optionalQuoted = (text: string, value: unknown): string => value === undefined || value === null || value === '' ? '' : quoted(text, value);
function weekParam(value: unknown, expected: number): void {
  if (value === undefined || value === null || value === '') return;
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (n !== expected) throw new PracticeError('week_mismatch');
}

/** Tool input is untrusted. Whitelist by call type; week, dates and sources never come from the model. */
export function capture(snapshot: Snapshot, kind: Kind, week: number, timezone: string, input: unknown, now = new Date()): Snapshot {
  const v = obj(input); const id = wording(v?.['event_id'], 100); const callerText = wording(v?.['caller_text'], 16000);
  const existing = snapshot.receipts.find(r => r.id === id);
  const type = str(v?.['command']) ?? ''; let command: Command;
  const confirmed = v?.['confirmed'] === true || v?.['confirmed'] === 'true';
  const confirmation = (): void => { if (!confirmed || !hasAgreement(callerText)) throw new PracticeError('caller_confirmation_required'); };
  const allowed = (...kinds: Kind[]): void => { if (!kinds.includes(kind)) throw new PracticeError('command_not_allowed'); };
  const p = snapshot.programme;
  if (!(VOICE_COMMANDS as readonly string[]).includes(type)) throw new PracticeError('command_not_allowed');
  confirmation();
  switch (type) {
    case 'wish': {
      allowed('opening', 'weekly');
      // Revision is a week-3 act; an unfinished wish stage may be completed in weeks 1-2.
      if (kind === 'weekly' && (week >= ARC_WEEKS || (currentWish(p) && week !== 3))) throw new PracticeError('command_not_allowed');
      command = { type, text: quoted(callerText, v?.['text']), why: optionalQuoted(callerText, v?.['why_text']) }; break;
    }
    case 'block': {
      allowed('weekly'); if (week >= ARC_WEEKS) throw new PracticeError('command_not_allowed');
      weekParam(v?.['week'], week);
      command = { type, text: quoted(callerText, v?.['text']), kind: parseBlockKind(v?.['kind']), week }; break;
    }
    case 'step': {
      allowed('opening', 'weekly'); if (kind === 'weekly' && week >= ARC_WEEKS) throw new PracticeError('command_not_allowed');
      const forWeek = kind === 'opening' ? 1 : week + 1; weekParam(v?.['week'], forWeek);
      command = { type, week: forWeek, text: quoted(callerText, v?.['text']) }; break;
    }
    case 'step_outcome': {
      allowed('weekly'); weekParam(v?.['week'], week);
      command = { type, week, outcome: parseOutcome(v?.['outcome']), outcomeText: optionalQuoted(callerText, v?.['outcome_text']) }; break;
    }
    case 'light': {
      allowed('light', 'weekly');
      command = { type, text: quoted(callerText, v?.['text']), occurredOn: localDay(now, timezone), source: kind === 'light' ? 'light_call' : 'weekly_call', week }; break;
    }
    case 'closing': {
      allowed('weekly'); if (week !== ARC_WEEKS) throw new PracticeError('command_not_allowed');
      command = { type, text: quoted(callerText, v?.['text']), carryText: optionalQuoted(callerText, v?.['carry_text']) }; break;
    }
    case 'light_schedule': {
      const days = parseDays(v?.['days']); const words = normalise(callerText).split(' ');
      if (days.length) {
        allowed('opening', 'weekly');
        if (days.some(d => !words.some(w => DAY_WORDS[d]!.some(p => w.startsWith(p))))) throw new PracticeError('caller_words_required');
        command = { type, days, minute: parseTime(v?.['time']) };
      } else {
        // Declining or stopping light calls is allowed wherever the caller says it.
        if (!/\b(no|not|stop|don t|dont|nei|ikke|slutt|stopp)\b/u.test(normalise(callerText))) throw new PracticeError('caller_confirmation_required');
        command = { type, days: [], minute: null };
      }
      break;
    }
    case 'pause': {
      allowed('opening', 'weekly');
      if (!/\b(pause|stop|stopp|paus)\b/iu.test(callerText)) throw new PracticeError('caller_confirmation_required');
      command = { type }; break;
    }
    default: throw new PracticeError('command_not_allowed');
  }
  if (existing) {
    if (existing.command.type === 'light' && command.type === 'light') command.occurredOn = existing.command.occurredOn;
    if (normalise(existing.callerText) !== normalise(callerText) || JSON.stringify(existing.command) !== JSON.stringify(command)) throw new PracticeError('event_conflict');
    return snapshot;
  }
  if (command.type === 'light' && snapshot.receipts.filter(r => r.command.type === 'light').length >= 5) throw new PracticeError('session_full');
  const next = structuredClone(snapshot);
  next.programme = applyCommand(snapshot.programme, command, id, now); next.receipts.push({ id, callerText, command });
  next.coverage[command.type] = 'done';
  if (next.receipts.length > 100) throw new PracticeError('session_full');
  return next;
}

/** Reconcile against the signed caller transcript before canonical memory changes. */
export function verifiedProgramme(snapshot: Snapshot, callerTranscript: string | readonly string[]): Programme {
  const turns = typeof callerTranscript === 'string' ? [callerTranscript] : callerTranscript;
  const joined = turns.join(' ');
  for (const receipt of snapshot.receipts) {
    if (!containsWords(joined, receipt.callerText)) throw new PracticeError('transcript_unconfirmed');
    // Every Unblock save needs a read-back: a whole consecutive caller span ending in explicit agreement.
    let confirmed = false;
    for (let start = 0; start < turns.length && !confirmed; start++) {
      let span = '';
      for (let end = start; end < turns.length; end++) {
        span += (span ? ' ' : '') + turns[end]!;
        if (normalise(span) === normalise(receipt.callerText) && explicitAgreement(turns[end]!)) { confirmed = true; break; }
        if (normalise(span).length > normalise(receipt.callerText).length) break;
      }
    }
    if (!confirmed) throw new PracticeError('caller_confirmation_required');
  }
  return snapshot.programme;
}
export const heldCall = (snapshot: Snapshot, kind: Kind, week: number): boolean => callHeld(kind, week, snapshot.receipts.map(r => r.command.type));

/** Closed sessions retain identifiers and capture kinds, not another copy of private words. */
export function closedSnapshot(snapshot: Snapshot, kind: Kind, week: number, canonicalVerified = false): string {
  return JSON.stringify({ revision: snapshot.revision, kind, week, events: snapshot.receipts.map(r => r.id), captureKinds: snapshot.receipts.map(r => r.command.type), canonicalVerified, closed: true });
}
