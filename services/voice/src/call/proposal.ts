import { normalise } from '../turn/endpointer.ts';
import type { Turn } from './outcome.ts';

const filler = new Set('i me my we you the a an to for of and or it this that want would like maybe perhaps just uh um mm yeah yes because'.split(' '));
const words = (text: string): string[] => normalise(text).split(' ').filter(w => w && !filler.has(w))
  .map(w => w.length > 5 && w.endsWith('ing') ? w.slice(0, -3).replace(/(.)\1$/, '$1') : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);

/** Conservative evidence for a recap-only proposal. Every content word must
 * come from this caller, with an adjacent phrase in their recent contribution.
 * This is never sufficient evidence to store a commitment or infer agreement. */
export function callerSupportedProposal(proposal: string, preceding: readonly Turn[]): boolean {
  const wanted = words(proposal);
  if (!wanted.length) return false;
  const callers = preceding.filter(t => t.speaker === 'caller').map(t => t.text);
  const history = new Set(words(callers.join(' ')));
  if (!wanted.every(w => history.has(w))) return false;
  const recent = words(preceding.slice(-20).filter(t => t.speaker === 'caller').map(t => t.text).join(' ')).slice(-80);
  const adjacent = wanted.length === 1 ? recent.includes(wanted[0]!) : wanted.some((w, i) => i + 1 < wanted.length
    && recent.some((r, j) => r === w && recent[j + 1] === wanted[i + 1]));
  if (!adjacent) return false;
  const blocks: string[] = [];
  for (const turn of preceding) {
    if (turn.speaker === 'agent') { blocks.push(''); continue; }
    if (!blocks.length) blocks.push('');
    blocks[blocks.length - 1] += ' ' + turn.text;
  }
  const latestFull = blocks.findLast(block => wanted.every(w => words(block).includes(w)));
  return !latestFull || !/\b(dont|do not|never|refuse|ikke|aldri)\b/.test(normalise(latestFull));
}
