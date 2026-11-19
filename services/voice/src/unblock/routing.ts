import { createHash } from 'node:crypto';

export interface RoutingState {
  country: 'NO' | 'other' | 'unknown';
  stage: 'normal' | 'support' | 'country' | 'done';
  lastUtterance: string;
  event?: string;
  questionPending: boolean;
}
export const CURRENT_COUNTRY_QUESTION = 'Which country are you in right now?';
const clean = (text: string): string => text.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ').trim();

/** Narrow self-report recognition: never use a phone prefix, timezone, enrolment declaration or an imagined location. */
function reportedCountry(text: string, answeringCountry: boolean): RoutingState['country'] | undefined {
  const t = clean(text);
  const sentences = t.split(/[.!?,;]+|\s+but\s+/).map(s => s.trim().replace(/^(?:(?:but|actually|sorry|correction)\s+)+/, '')).filter(Boolean);
  if (/\b(?:i am|i'm|im) (?:not |no longer )in norway\b|\bi (?:have left|left) norway\b|\b(?:i am|i'm|im) (?:currently )?(?:outside norway|abroad)\b/.test(t)) return 'other';
  if (/\b(?:i do not|i don't) know (?:which country|where i am)\b|\bi(?: am|'m) not sure\b.*\b(?:where|which country|in norway)\b/.test(t)) return 'unknown';
  const selfLocations = sentences.flatMap(s => {
    const m = /^(?:i am|i'm|im) (?:(?:currently|right now|actually) )?(?:here |physically )?in (.+?)(?: right now| at the moment| now)?$/.exec(s);
    return m ? [m[1]!] : [];
  });
  if (selfLocations.length) return selfLocations.every(p => p === 'norway') ? 'NO' : 'unknown';
  if (answeringCountry) return /^(?:(?:here |currently )?in )?norway(?: right now| at the moment| now| today)?[.! ]*$/.test(t) ? 'NO' : /^(?:unknown|i don't know|i do not know|not sure|i'd rather not say)[.! ]*$/.test(t) ? 'unknown' : 'other';
  return undefined;
}

/** Ephemeral per-call state, scrubbed on completion. Retry handling must not skip the support-answer/country-question sequence. */
export function advanceRouting(previous: RoutingState | undefined, callerText: string, held: boolean, event?: string): RoutingState | undefined {
  const hash = createHash('sha256').update(callerText).digest('hex');
  if (previous && event && previous.event === event && previous.lastUtterance !== hash) {
    return { country: 'unknown', stage: 'done', lastUtterance: hash, event, questionPending: false };
  }
  if (previous && (event && previous.event === event || !event && previous.lastUtterance === hash)) return previous;
  const reported = reportedCountry(callerText, held && (previous?.stage === 'country' || previous?.stage === 'done' && previous.country === 'unknown'));
  if (!held && !previous && reported === undefined) return undefined;
  const country = reported ?? previous?.country ?? 'unknown';
  const stage = !held ? 'normal' : !previous || previous.stage === 'normal' ? 'support'
    : previous.stage === 'support' ? country === 'unknown' ? 'country' : 'done' : 'done';
  return { country, stage, lastUtterance: hash, ...(event ? { event } : {}), questionPending: stage === 'country' };
}

export function routingFor(state?: RoutingState): Record<string, unknown> {
  const country = state?.country ?? 'unknown';
  return {
    country,
    source: country === 'NO' ? 'caller_self_report_this_call' : 'unconfirmed_or_outside_norway',
    ...(state?.questionPending ? { country_question: CURRENT_COUNTRY_QUESTION } : {}),
    ...(country === 'NO' ? {
      medical_emergency: { number: '113', instruction: 'For immediate medical danger. Emergency direction does not wait for operator acknowledgement.' },
      urgent_medical_help: { number: '116 117', instruction: 'For urgent medical help that cannot wait when the GP is unavailable, without an immediate emergency. Never select this merely from a keyword tier.' },
    } : { instruction: 'Use the country-neutral instruction to contact local emergency services. No Norwegian or guessed foreign number. A declined/unknown location is accepted without repeatedly asking.' }),
  };
}
