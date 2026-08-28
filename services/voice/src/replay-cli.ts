import { endpointing } from './config.ts';
import { replay, type Fixture } from './turn/replay.ts';
import fixtures from '../test/fixtures/pauses.json' with { type: 'json' };

/**
 * npm run replay [sensitivity...]
 *
 * Shows what each endpointing setting would do to the corpus: whether it cuts
 * anyone off, and how long it makes everyone else wait. The two columns are the
 * whole trade-off.
 */
const args = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const levels = args.length ? args : [0, 0.25, 0.5, 0.75, 1];
const corpus = (fixtures as Fixture[]).filter((f) => !f.expectNoTurn);

console.log('\nEndpointing replay — timing traces, no audio, no vendor\n');
console.log('  sens   false cuts   median lateness   worst lateness');
console.log('  ' + '─'.repeat(56));

for (const s of levels) {
  const cfg = endpointing(s);
  const results = corpus.map((f) => replay(f, cfg));
  const cuts = results.filter((r) => r.falseCut);
  const late = results.filter((r) => !r.falseCut).map((r) => r.latenessMs ?? 0).sort((a, b) => a - b);
  const median = late.length ? late[Math.floor(late.length / 2)] : 0;
  const worst = late.length ? late[late.length - 1] : 0;
  const flag = cuts.length ? ' ✕' : '  ';
  console.log(
    `${flag} ${String(s).padEnd(6)} ${String(cuts.length).padStart(6)} / ${corpus.length}   ${String(median).padStart(10)} ms   ${String(worst).padStart(10)} ms`,
  );
  for (const c of cuts) console.log(`         cut: ${c.id} at ${c.endpointedAtMs}ms`);
}

console.log('\n  A false cut is a person talked over mid-thought. Lateness is dead air.');
console.log('  Ship zero cuts first; only then trade lateness down.\n');
