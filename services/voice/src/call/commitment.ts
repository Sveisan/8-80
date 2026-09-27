import { normalise } from '../turn/endpointer.ts';
import type { ScriptLines } from '../script.ts';

/**
 * What they committed to, taken from the line where the mentor reads it back.
 *
 * SCRIPT.md pins the commitment on purpose — `next.confirm` is "Right.
 * {{commitment}}, {{day}}. Will you?" — and that read-back
 * is the one moment in the call where the thing is stated plainly, by us, in
 * their words. So we take it from there rather than guessing at the caller's
 * transcript, where the commitment is buried in the reasoning around it.
 *
 * If the read-back never happened, no commitment was reached, and saying so is
 * correct: next week's call must not open by quoting something they never said.
 */
export interface Commitment {
  text: string;
  day?: string;
}

/** Build a matcher from the template, so the words stay in SCRIPT.md. */
export function extractCommitment(spoken: string, script: ScriptLines): Commitment | undefined {
  const template = script.get('next.confirm');
  if (!template) return undefined;

  // "Right. {{commitment}}, {{day}}. That's what..." → the fixed text around
  // the slots, which is what we anchor on.
  const [before, middle, after] = template.split(/\{\{commitment\}\}|\{\{day\}\}/);
  if (before === undefined || middle === undefined) return undefined;

  const anchor = (s: string) => normalise(s).trim();
  const said = normalise(spoken);
  const head = anchor(before);
  const tail = anchor(after ?? '');

  // Anchor on the head NEAREST the tail, not the first one in the text. The
  // head is "Right", which the mentor says all through a call; taking the
  // first one sent a recap containing everything from "Right — I've got the
  // shape of it" onwards, as the commitment.
  const end = tail ? said.lastIndexOf(tail) : -1;
  const upTo = end > 0 ? said.slice(0, end) : said;
  if (head && !upTo.includes(head)) return undefined;
  const rest = (head ? upTo.slice(upTo.lastIndexOf(head) + head.length) : upTo).trim();
  if (!rest) return undefined;

  // The template separates the two slots with a comma, and punctuation does not
  // survive normalising — so the separator is usually nothing at all. The day
  // is found by looking for a day, which is also what works when the mentor
  // says "run three times on Wednesday" instead of reading the slots apart.
  const sep = anchor(middle);
  if (sep) {
    const parts = rest.split(new RegExp(`\\s${sep}\\s`));
    const head2 = (parts[0] ?? rest).trim();
    const tail2 = parts.slice(1).join(' ').trim();
    if (head2) return { text: head2, day: tail2 || undefined };
  }

  const day = dayIn(rest);
  const text = day ? rest.replace(new RegExp(`(\\son)?\\s${day}\\b.*$`), '').trim() : rest;
  return text ? { text, day } : undefined;
}

/** The days a commitment can be pinned to, for reading one back out of a phrase. */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** Best-effort day, when the read-back ran the two slots together. */
export function dayIn(text: string): string | undefined {
  const words = normalise(text).split(' ');
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i] as string;
    if (DAYS.includes(w)) return w;
  }
  return undefined;
}
