import { config } from '../config.ts';
import { PostgresStore } from '../store/postgres.ts';

/**
 * npx tsx services/voice/src/call/followthrough-cli.ts
 *
 * The number the product exists to move: of the weeks a call established how
 * last week went, how many the commitment was done. Totals across everybody,
 * never a list of who.
 */
if (!config.database.url) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}
const store = new PostgresStore(config.database.url);
try {
  const t = await store.followThrough();
  const weeks = t.done + t.partly + t.undone;
  const pct = (n: number) => (weeks ? `${Math.round((n / weeks) * 100)}%` : '—');
  console.log(`${weeks} weeks established, across ${t.callers} callers`);
  console.log(`  done    ${String(t.done).padStart(4)}  ${pct(t.done)}`);
  console.log(`  partly  ${String(t.partly).padStart(4)}  ${pct(t.partly)}`);
  console.log(`  not     ${String(t.undone).padStart(4)}  ${pct(t.undone)}`);
} finally {
  await store.close();
}
