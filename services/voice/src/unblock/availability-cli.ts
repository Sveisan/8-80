import { config } from '../config.ts';
import { PostgresStore } from '../store/postgres.ts';
import { setUnblockAvailability, unblockAvailability } from './availability.ts';

const args = process.argv.slice(2);
if (args.length !== 1 || !['--status', '--available', '--away'].includes(args[0]!)) {
  console.error('Use: npm run unblock:availability -- --status|--available|--away'); process.exitCode = 1;
} else if (!config.database.url) {
  console.error('DATABASE_URL is required.'); process.exitCode = 1;
} else {
  const store = new PostgresStore(config.database.url);
  try {
    const state = args[0] === '--status' ? await unblockAvailability(store.raw) : await setUnblockAvailability(store.raw, args[0] === '--available');
    console.log(JSON.stringify({ state: state.available ? 'Available' : 'Away', expiresAt: state.expiresAt?.toISOString() ?? null, timezone: 'Europe/Oslo' }));
  } catch {
    console.error('Availability was not confirmed. Check migrations and the Oslo working day (before 17:00); run --status.'); process.exitCode = 1;
  } finally { await store.close(); }
}
