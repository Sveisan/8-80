import type { ScriptLines } from '../script.ts';
import type { CallOutcome } from '../store/types.ts';

/**
 * What a paragraph is for, so a renderer can style it without reading English.
 *
 * `letter.ts` needs to set the one thing larger than the line about how long
 * the call ran. It could find it by position — first paragraph, last paragraph
 * — but position is an accident of which keys SCRIPT.md happens to define, and
 * the first email to go out wrong went out wrong for exactly that kind of
 * reason. A role survives a writer adding a sentence.
 */
export type RecapRole = 'lead' | 'body' | 'quiet' | 'signoff';

export interface RecapPart {
  role: RecapRole;
  text: string;
}

export interface Recap {
  subject: string;
  /** The whole letter as text, paragraphs joined by a blank line. */
  body: string;
  /** The same paragraphs, in order, each tagged with what it is doing. */
  parts: RecapPart[];
  /** The letterhead's date, carried through so the renderer needs only a Recap. */
  date?: string;
}

export interface RecapContext {
  /** How the next call was referred to out loud, e.g. "Tuesday at nine". */
  nextSlot?: string;
  /**
   * The day of the call, in the caller's own zone and language.
   *
   * Formatted by the caller of this function rather than here, because the
   * zone lives with the slot and a date formatted in the server's zone is the
   * same class of bug as a weekday formatted in the server's zone — which has
   * already cost somebody a call once.
   */
  date?: string;
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

  const paragraphs: (RecapPart | undefined)[] = (
    outcome.commitment
      ? [
          part('lead', fill(script.get('email.body.commitment'))),
          part('body', fill(script.get('email.body.ask'))),
        ]
      : [part('lead', fill(script.get('email.body.none')))]
  ).concat(part('quiet', fill(script.get(minutes === 1 ? 'email.body.logistics.one' : 'email.body.logistics'))));

  // Last, always, and never dropped by the empty-slot rule above: it has no
  // slots to be empty. An email that ends on "We spoke for eight minutes." is
  // the one that arrived reading as blank.
  paragraphs.push(part('signoff', fill(script.get('email.signoff'))));

  const subjectKey = outcome.commitment ? 'email.subject' : 'email.subject.none';
  const subject = fill(script.get(subjectKey)) ?? fill(script.get('email.subject.none')) ?? '';

  const parts = paragraphs.filter((p): p is RecapPart => p !== undefined);

  return {
    // A commitment with no day reads "run three times, ." without the trim.
    subject: subject.replace(/[—–-]\s*$/, '').trim(),
    body: parts.map((p) => p.text).join('\n\n'),
    parts,
    ...(ctx.date ? { date: ctx.date } : {}),
  };
}

const part = (role: RecapRole, text: string | undefined): RecapPart | undefined =>
  text ? { role, text } : undefined;
