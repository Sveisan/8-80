import { normalise } from '../turn/endpointer.ts';

/**
 * The caller's words, taken out of a line where the mentor read them back.
 *
 * The same idea as commitment.ts, for any SCRIPT.md line with slots in it: the
 * read-back is the one moment their words are said plainly and on purpose, so
 * that is where they are taken from, rather than guessed at from the caller's
 * side of the transcript. The fixed text around the slots is the anchor, so
 * the words stay in SCRIPT.md and a rewrite of the line moves this with it.
 *
 * Returns undefined unless every slot came back with something in it: a
 * half-read line is not a read-back, and next week must not quote a fragment.
 */
export function extractSlots(
  spoken: string,
  template: string | undefined,
  opts: { strict?: boolean } = {},
): Record<string, string> | undefined {
  if (!template) return undefined;
  const parts = template.split(/\{\{([^}]+)\}\}/);
  // parts alternates literal, slot, literal, slot, ... literal.
  const literals = parts.filter((_, i) => i % 2 === 0).map((l) => normalise(l));
  const slots = parts.filter((_, i) => i % 2 === 1);
  if (!slots.length) return undefined;

  const said = normalise(spoken);
  const head = literals[0] ?? '';

  // The line may have been said more than once — asked to repeat, or started
  // over after being talked over. The last complete one is what they heard.
  const starts: number[] = [];
  if (head) {
    for (let i = said.indexOf(head); i >= 0; i = said.indexOf(head, i + 1)) starts.push(i + head.length);
  } else {
    starts.push(0);
  }

  for (const start of starts.reverse()) {
    const out: Record<string, string> = {};
    let pos = start;
    let ok = true;
    slots.forEach((name, i) => {
      if (!ok) return;
      const next = literals[i + 1] ?? '';
      const end = next ? said.indexOf(next, pos) : -1;
      // The last slot may run to the end of the turn when the closing words
      // were dropped — never when reading a whole call, where the end is
      // everything else anybody said.
      const open = i === slots.length - 1 && !opts.strict;
      const value = (end >= 0 ? said.slice(pos, end) : open ? said.slice(pos) : '').trim();
      if (!value) {
        ok = false;
        return;
      }
      out[name] = value;
      pos = end >= 0 ? end + next.length : said.length;
    });
    if (ok) return out;
  }
  return undefined;
}

/**
 * The read-back in a call: the last agent turn that carries the whole line,
 * or, when a backchannel split it across turns, the whole call read strictly.
 */
export function readBack(agentTurns: readonly string[], template: string | undefined): Record<string, string> | undefined {
  for (let i = agentTurns.length - 1; i >= 0; i--) {
    const found = extractSlots(agentTurns[i] ?? '', template);
    if (found) return found;
  }
  return extractSlots(agentTurns.join(' '), template, { strict: true });
}
