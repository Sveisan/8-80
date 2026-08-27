import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * SCRIPT.md is the source of truth for every word the mentor says.
 *
 * Lines are keyed (`open.return.callback`) and the loop only ever references
 * keys. English is one locale's values for those keys; adding Norwegian is a
 * values file, not a change here. Eirik rewrites SCRIPT.md and it takes effect
 * on the next call with no code change, which is the point.
 *
 * Format parsed:
 *     `some.id`
 *     > "first line"
 *     > "continued"
 */
export type ScriptLines = Map<string, string>;

const ID = /^`([a-z0-9_.|{}]+)`\s*$/;
const QUOTED = /^>\s?(.*)$/;

export function parseScript(markdown: string): ScriptLines {
  const lines = markdown.split('\n');
  const out: ScriptLines = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = ID.exec(lines[i] ?? '');
    if (!m || !m[1]) continue;
    const parts: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const q = QUOTED.exec(lines[j] ?? '');
      if (!q) break;
      parts.push((q[1] ?? '').trim());
      i = j;
    }
    if (!parts.length) continue;
    const text = parts
      .join(' ')
      .replace(/\s+/g, ' ')
      .replace(/^"|"$/g, '')
      .trim();
    if (text) out.set(m[1], text);
  }
  return out;
}

export function loadScript(path?: string): ScriptLines {
  const here = dirname(fileURLToPath(import.meta.url));
  const p = path ?? process.env.SCRIPT_PATH ?? resolve(here, '../../../SCRIPT.md');
  return parseScript(readFileSync(p, 'utf8'));
}

/**
 * Turns after which the user needs materially more room. Used by the endpointer
 * to extend patience, and by the timekeeper to suppress the billing courtesy.
 */
export const HARD_TURNS = new Set([
  'nothing.a',
  'nothing.b',
  'nothing.c',
  'nothing.c.follow',
  'nothing.pattern',
  'block.internal',
  'read.neither',
  'read.one_sided',
  'next.ask.a',
  'next.ask.b',
  'next.ask.c',
  'next.ask.c.calibrate',
  'close.q.b',
]);
