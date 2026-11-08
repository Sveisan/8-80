import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const UNBLOCK_KINDS = ['opening', 'weekly', 'light'] as const;
export type UnblockKind = (typeof UNBLOCK_KINDS)[number];

export function unblockScriptPath(kind: UnblockKind): string {
  return resolve(import.meta.dirname, '../../../../docs/unblock', `${kind}-script.md`);
}

export function readUnblockScript(kind: UnblockKind): string {
  return readFileSync(unblockScriptPath(kind), 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const kind = process.argv[2];
  if (!UNBLOCK_KINDS.includes(kind as UnblockKind)) {
    console.error(`Use: npm run unblock:prompt -- ${UNBLOCK_KINDS.join('|')}`);
    process.exitCode = 1;
  } else {
    console.log(readUnblockScript(kind as UnblockKind));
  }
}
