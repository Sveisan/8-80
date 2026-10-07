import type { ScriptLines } from '../script.ts';
import type { Turn } from './outcome.ts';

/**
 * Whether a finished call needs a person to look at it, and how soon.
 *
 *   Tier 1 — same evening, by text. Self-harm, suicide, wanting to be dead,
 *            or the mentor's own crisis acknowledgement, which it only says
 *            when it has decided something serious was said.
 *   Tier 2 — the daily digest. Abuse, violence, feeling unsafe, hopelessness.
 *
 * Either holds the caller's next call until somebody has reviewed it: the
 * agent must not ring cheerfully on schedule the day after.
 *
 * Deliberately crude and deliberately cautious. A false alarm costs one
 * person one review; a miss costs a great deal more, so these patterns err
 * wide. They are a net under the mentor's judgement, not a replacement for
 * it, and they will miss things said obliquely — which is why the mentor's
 * own acknowledgement line counts as tier 1 on its own.
 *
 * Returns the names of what matched, never the words, so the reason can be
 * logged and texted without a sentence of the call leaving the database.
 */
export type SafetyTier = 1 | 2;

export interface SafetyFinding {
  tier: SafetyTier;
  reasons: string[];
}

/** Said by the caller. English and Norwegian, because both are spoken. */
const TIER_1: [string, RegExp][] = [
  ['suicide', /\bsuicid\w*|\bselvmord\w*/i],
  ['kill_myself', /\bkill(ing)? myself\b|\bend(ing)? (it all|my life)\b|\bta(r)? livet (mitt|av meg)\b/i],
  ['self_harm', /\b(hurt|harm|cut)(ing)? myself\b|\bself[- ]harm\w*|\bskade meg selv\b/i],
  ['not_wanting_to_live', /\b(don'?t|do not) want to (be here|live|be alive)\b|\bbetter off (dead|without me)\b|\bvil ikke leve\b|\borker ikke (å )?leve\b/i],
];

const TIER_2: [string, RegExp][] = [
  ['violence', /\b(hits?|hitting|beats?|beating) me\b|\bviolen(t|ce)\b|\bvold\w*|\bslår meg\b/i],
  ['abuse', /\babus(e|ed|ive)\b|\bmishandl\w*|\bovergrep\w*/i],
  ['unsafe', /\b(not|don'?t feel) safe\b|\bunsafe\b|\bikke trygg\b|\butrygg\b/i],
  ['hopeless', /\bhopeless\b|\bno point (in|to) (anything|living|any of it)\b|\bcan'?t go on\b|\bhåpløs\w*|\borker ikke mer\b/i],
];

export function safetyTier(turns: readonly Turn[], script: ScriptLines): SafetyFinding | undefined {
  const said = turns.filter((t) => t.speaker === 'caller').map((t) => t.text).join(' \n ');
  const mentor = turns.filter((t) => t.speaker === 'agent').map((t) => t.text).join(' \n ');

  const reasons1 = TIER_1.filter(([, re]) => re.test(said)).map(([name]) => name);
  // The mentor's crisis acknowledgement. It is a fixed line so it can be found
  // here; the model says it only when it has judged something serious.
  const ack = script.get('safety.ack');
  if (ack && normalised(mentor).includes(normalised(ack))) reasons1.push('mentor_acknowledged_crisis');
  if (reasons1.length) return { tier: 1, reasons: reasons1 };

  const reasons2 = TIER_2.filter(([, re]) => re.test(said)).map(([name]) => name);
  if (reasons2.length) return { tier: 2, reasons: reasons2 };
  return undefined;
}

function normalised(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The text that reaches the operator. Nothing from the call is in it — not a
 * word, not the reason it was flagged, not a name or a number — because a
 * text sits on a lock screen. The review command is where the detail is.
 */
export function alertText(tier: SafetyTier, count = 1): string {
  return tier === 1
    ? '8&80: a call needs review tonight (tier 1). Their next call is on hold. On the server: npm run enrol -- --review'
    : `8&80: ${count} call${count === 1 ? '' : 's'} waiting for review (tier 2). Next calls are on hold. On the server: npm run enrol -- --review`;
}
