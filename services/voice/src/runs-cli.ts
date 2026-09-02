import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './config.ts';

/**
 * npm run runs
 *
 * Every stress run, side by side. Tuning endpointing off a single call is how
 * you end up chasing one bad evening; this is the table that stops that.
 *
 * Sorted by sensitivity so the trade-off reads down the page: the false-cut
 * column must stay at zero, and only then is lateness worth trading down.
 */
interface Run {
  runId: string;
  endpointing?: { sensitivity?: number };
  turnTaking?: string;
  variants?: Record<string, string>;
  scores?: Record<string, number>;
  notes?: string;
  objective?: {
    timeToFirstAudioMs?: number | null;
    medianEndpointLatencyMs?: number | null;
    falseInterruptions?: number;
    backchannelsIgnored?: number;
    bargeIns?: number;
    turns?: number;
  } | null;
}

const dir = resolve(repoRoot, 'runs');
if (!existsSync(dir)) {
  console.log('\nNo runs yet. `npm run stress` writes them to runs/.\n');
  process.exit(0);
}

const runs: Run[] = readdirSync(dir)
  .filter((f) => f.startsWith('stress-') && f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Run)
  .sort((a, b) => (a.endpointing?.sensitivity ?? 0) - (b.endpointing?.sensitivity ?? 0));

if (!runs.length) {
  console.log('\nNo stress runs in runs/ yet.\n');
  process.exit(0);
}

const n = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? '—' : `${v}${unit}`);
const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '—');

console.log(`\n${runs.length} stress run(s)\n`);
console.log('  sens   cuts  ttfa     median wait  barge  backch   pauses  weekly  run');
console.log('  ' + '─'.repeat(78));
for (const r of runs) {
  const o = r.objective ?? {};
  const s = r.scores ?? {};
  console.log(
    `  ${String(r.endpointing?.sensitivity ?? '—').padEnd(6)}` +
      `${String(o.falseInterruptions ?? '—').padStart(4)}  ` +
      `${n(o.timeToFirstAudioMs, 'ms').padEnd(8)} ` +
      `${n(o.medianEndpointLatencyMs, 'ms').padStart(11)}  ` +
      `${String(o.bargeIns ?? '—').padStart(5)}  ` +
      `${String(o.backchannelsIgnored ?? '—').padStart(6)}  ` +
      `${String(s['handledPauses'] ?? '—').padStart(7)}  ` +
      `${String(s['wouldWantWeekly'] ?? '—').padStart(6)}  ` +
      `${r.runId?.slice(0, 16) ?? ''}`,
  );
}

const scored = runs.filter((r) => r.scores);
if (scored.length > 1) {
  console.log('\n  averages across runs');
  for (const k of ['naturalness', 'latencyFeel', 'didItInterrupt', 'handledPauses', 'wouldWantWeekly']) {
    const xs = scored.map((r) => r.scores?.[k]).filter((x): x is number => typeof x === 'number' && !Number.isNaN(x));
    console.log(`    ${k.padEnd(16)} ${avg(xs)}`);
  }
}

const notes = runs.filter((r) => r.notes?.trim());
if (notes.length) {
  console.log('\n  notes');
  for (const r of notes) console.log(`    ${String(r.endpointing?.sensitivity ?? '?')}  ${r.notes?.trim()}`);
}

console.log('\n  cuts must be 0 before lateness is worth trading down.\n');
