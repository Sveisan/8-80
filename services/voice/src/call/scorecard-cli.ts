import { readFileSync } from 'node:fs';
import { loadScript } from '../script.ts';
import { formatScorecard, parseConsoleExport, scoreCall } from './scorecard.ts';

/**
 * npx tsx services/voice/src/call/scorecard-cli.ts <transcript.txt> [first|return]
 *
 * Scores a transcript exported from the Speechify console against SCRIPT.md.
 * With no second argument, a call that opens on the first-call greeting is
 * read as a first call. Exits 1 when any check failed, so a folder of calls
 * can be run in a loop and the bad ones picked out.
 *
 * The transcript stays where you put it: nothing is written, nothing is sent.
 */
const [path, kind] = process.argv.slice(2);
if (!path) {
  console.error('usage: scorecard-cli.ts <transcript.txt> [first|return]');
  process.exit(2);
}

const turns = parseConsoleExport(readFileSync(path, 'utf8'));
if (!turns.length) {
  console.error(`no "[m:ss] Agent: …" lines found in ${path}`);
  process.exit(2);
}

const card = scoreCall(loadScript(), turns, kind ? { first: kind === 'first' } : {});
console.log(formatScorecard(card));
process.exit(card.findings.some((f) => f.severity === 'fail') ? 1 : 0);
