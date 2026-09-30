import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../config.ts';
import type { ScriptLines } from '../script.ts';

/**
 * The contact card: the only way our name ever reaches the call screen.
 *
 * Norwegian carriers never show a caller name, and an SMS thread shows a bare
 * number until somebody saves it. So "8&80" on Tuesday morning, with the mark
 * where a friend's face would be, exists only if it is in their own address
 * book — and the moment they are most willing to put it there is the minute
 * after signing up. ARCHITECTURE.md, "The vCard is the only branding channel".
 *
 * vCard 3.0, not 4.0: it is what iOS and older Android both import without
 * asking questions. The card holds nothing about the caller, so it is the same
 * file for everybody and needs no link to fetch.
 */

/**
 * The number on the card. It must be the number that rings them, exactly, in
 * E.164: the handset matches an incoming call to a contact by string, and a
 * card saved as "900 08 800" against a call presented as "+4790008800" fails
 * silently with no error anywhere in our system. Preflight already insists the
 * call and the text come from one number; the text's is read first because it
 * is the one the Twilio side is configured with, and the call's is the fallback.
 */
export function contactNumber(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const n = (env['SMS_FROM_NUMBER'] || env['SPEECHIFY_CALLER_ID_NUMBER'] || '').replace(/[\s()-]/g, '');
  return /^\+[1-9]\d{6,14}$/.test(n) ? n : undefined;
}

/** brand/assets/mark-contact.png — the mark on Night, square, so a circle crop of it still reads. */
let photo: string | undefined;
const photoBase64 = (): string => (photo ??= readFileSync(resolve(repoRoot, 'brand', 'assets', 'mark-contact.png')).toString('base64'));

/** RFC 2426 text escaping. "8&80" needs none; a translated name might. */
const text = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

/**
 * Lines longer than 75 octets are folded: CRLF and one space. The photo is a
 * few kilobytes on one logical line, and some importers refuse a card that
 * does not fold it.
 */
function fold(line: string): string {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += i === 0 ? 75 : 74) out.push(line.slice(i, i + (i === 0 ? 75 : 74)));
  return out.join('\r\n ');
}

export function vcard(script: ScriptLines, number: string, site?: string): string {
  const name = script.get('contact.name') || '8&80';
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    // The name goes in as a family name with nothing else, so no handset
    // invents a "first name" out of half of it.
    `N:${text(name)};;;;`,
    `FN:${text(name)}`,
    `ORG:${text(name)}`,
    `TEL;TYPE=CELL,VOICE:${number}`,
    ...(site ? [`URL:${site}`] : []),
    ...(script.get('contact.note') ? [`NOTE:${text(script.get('contact.note') as string)}`] : []),
    `PHOTO;ENCODING=b;TYPE=PNG:${photoBase64()}`,
    'END:VCARD',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
