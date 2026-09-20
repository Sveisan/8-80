import type { ScriptLines } from '../script.ts';
import type { CallOutcome } from '../store/types.ts';

export interface Recap {
  subject: string;
  body: string;
}

export interface RecapContext {
  /** How the next call was referred to out loud, e.g. "Tuesday at nine". */
  nextSlot?: string;
}

/**
 * The email the close promised.
 *
 * Every sentence comes from SCRIPT.md, like every sentence the mentor speaks —
 * this file fills slots and joins paragraphs and contains no English of its
 * own. Rewriting the email is editing a markdown file, and translating it is a
 * second values file rather than a second implementation.
 *
 * A missing key produces a shorter email rather than an exception or a visible
 * `{{slot}}`. Someone editing SCRIPT.md at eleven at night should be able to
 * break a line without breaking the send.
 */
export function composeRecap(outcome: CallOutcome, script: ScriptLines, ctx: RecapContext = {}): Recap {
  const minutes = Math.max(1, Math.round(outcome.durationMs / 60_000));
  const values: Record<string, string> = {
    commitment: outcome.commitment ?? '',
    day: outcome.day ?? '',
    minutes: String(minutes),
    next_slot: ctx.nextSlot ?? '',
  };

  const fill = (text: string | undefined): string | undefined => {
    if (text === undefined) return undefined;
    // A sentence whose slot has no value is dropped whole, rather than sent
    // with a hole in it. "I'll call you ." was going out to anybody whose next
    // call could not be described, and half a sentence in the one email this
    // product sends reads as a broken system, which is what it was.
    const kept = text
      .split(/(?<=\.)\s+/)
      .filter((sentence) => {
        const slots = [...sentence.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1] ?? '');
        // A sentence with no slots in it is just a sentence. `every` on an
        // empty list is true, so without this line every fixed sentence in the
        // email was dropped — including the subject, which has none.
        if (!slots.length) return true;
        // A day may be absent from a sentence that also carries the commitment
        // — "run three times, Wednesday." still works as "run three times." —
        // so only a sentence left with NOTHING to say is dropped.
        return slots.some((name) => values[name]);
      })
      .join(' ');

    return kept
      .replace(/\{\{([^}]+)\}\}/g, (_, name: string) => values[name] ?? '')
      // A commitment with no day leaves ", ." behind, and an em dash with
      // nothing after it. Tidying the punctuation here keeps the slots out of
      // SCRIPT.md's sentences, where a writer would have to think about them.
      .replace(/\s+,/g, ',')
      .replace(/,\s*\./g, '.')
      .replace(/,\s*$/, '')
      .replace(/\s+\./g, '.')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const paragraphs = (
    outcome.commitment
      ? [fill(script.get('email.body.commitment')), fill(script.get('email.body.ask'))]
      : [fill(script.get('email.body.none'))]
  ).concat(fill(script.get(minutes === 1 ? 'email.body.logistics.one' : 'email.body.logistics')));

  const subjectKey = outcome.commitment ? 'email.subject' : 'email.subject.none';
  const subject = fill(script.get(subjectKey)) ?? fill(script.get('email.subject.none')) ?? '';

  return {
    // A commitment with no day reads "run three times, ." without the trim.
    subject: subject.replace(/[—–-]\s*$/, '').trim(),
    body: paragraphs.filter((p): p is string => Boolean(p)).join('\n\n'),
  };
}
