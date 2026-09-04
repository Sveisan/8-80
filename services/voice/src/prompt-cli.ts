import { loadScript } from './script.ts';
import { buildInstructions } from './prompt.ts';
import { config } from './config.ts';

/**
 * npm run prompt            — a returning call
 * npm run prompt -- first   — the first call a user ever gets
 * npm run prompt -- third   — the third-week-running case
 *
 * Prints exactly what the model is told, assembled from SCRIPT.md. Edit the
 * script, run this, see the difference — no call, no keys, no network.
 */
const arg = process.argv[2] ?? 'return';
const script = loadScript();

const profile =
  arg === 'first'
    ? { callNumber: 1 }
    : arg === 'third'
      ? { callNumber: 4, lastCommitment: 'run three times', consecutiveUndone: 3 }
      : { callNumber: 2, lastCommitment: 'run three times' };

console.log('─'.repeat(72));
console.log(`SCRIPT.md: ${script.size} keyed lines · variants: ${config.variants.nothing} · ${config.variants.nextAsk} · ${config.variants.closeQ}`);
console.log('─'.repeat(72));
console.log(buildInstructions(script, profile));
console.log('─'.repeat(72));

const text = buildInstructions(script, profile);
const problems: string[] = [];
if (text.includes('!')) problems.push('contains an exclamation mark');
for (const w of ['amazing', 'great job', 'well done']) {
  if (new RegExp(`\\b${w}\\b`, 'i').test(text)) problems.push(`contains "${w}"`);
}
console.log(problems.length ? `\n  ✕ ${problems.join('; ')}\n` : '\n  · voice rules hold\n');
