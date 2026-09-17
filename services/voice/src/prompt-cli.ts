import { loadScript } from './script.ts';
import { buildInstructions, renderForConsole } from './prompt.ts';
import { config } from './config.ts';

/**
 * npm run prompt                      — a returning call
 * npm run prompt -- first              — the first call a user ever gets
 * npm run prompt -- third              — the third-week-running case
 * npm run --silent prompt -- first console
 *                                      — the same, rendered for the Speechify
 *                                        console and printed bare, so it can be
 *                                        piped to a file or the clipboard
 *                                        (--silent, or npm's own banner lands
 *                                        in the middle of what you paste)
 *
 * Prints exactly what the model is told, assembled from SCRIPT.md. Edit the
 * script, run this, see the difference — no call, no keys, no network.
 */
const args = process.argv.slice(2);
const console_ = args.includes('console');
const arg = args.find((a) => a !== 'console') ?? 'return';
const script = loadScript();

const profile =
  arg === 'first'
    ? { callNumber: 1 }
    : arg === 'third'
      ? { callNumber: 4, lastCommitment: 'run three times', consecutiveUndone: 3 }
      : { callNumber: 2, lastCommitment: 'run three times' };

if (console_) {
  // Bare, so the whole of stdout is the thing to paste. Everything else goes to
  // stderr, where a pipe will not pick it up.
  process.stderr.write(`SCRIPT.md: ${script.size} keyed lines · rendered for the Speechify console\n`);
  console.log(renderForConsole(buildInstructions(script, profile)));
} else {
  console.log('─'.repeat(72));
  console.log(`SCRIPT.md: ${script.size} keyed lines · variants: ${config.variants.nothing} · ${config.variants.nextAsk} · ${config.variants.closeQ}`);
  console.log('─'.repeat(72));
  console.log(buildInstructions(script, profile));
  console.log('─'.repeat(72));
}

// The voice rules apply to what the mentor SAYS, not to the prompt that tells it
// what not to say — linting the assembled text flagged the prohibition list
// itself every single run, which is how a check teaches people to ignore it.
const problems: string[] = [];
for (const [id, spoken] of script) {
  if (spoken.includes('!')) problems.push(`${id} contains an exclamation mark`);
  for (const w of ['amazing', 'great job', 'well done']) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(spoken)) problems.push(`${id} contains "${w}"`);
  }
}
console.log(problems.length ? `\n  ✕ ${problems.join('; ')}\n` : '\n  · voice rules hold\n');
