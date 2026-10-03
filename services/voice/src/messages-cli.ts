import { config } from './config.ts';
import { PostgresStore } from './store/postgres.ts';
import { messageReport, resolveMessage } from './messages/operations.ts';

const [command, id] = process.argv.slice(2);
if (!config.database.url) throw new Error('DATABASE_URL is required');
if (command && !['retry-confirmed-not-accepted', 'close-without-resend'].includes(command)) throw new Error('Usage: npm run messages [-- retry-confirmed-not-accepted|close-without-resend <id>]');
const store = new PostgresStore(config.database.url);
try {
  if (command) {
    if (!id) throw new Error('Message id required. Inspect the provider record before choosing an outcome.');
    const changed = await resolveMessage(store.raw, id, command as 'retry-confirmed-not-accepted' | 'close-without-resend');
    if (!changed) throw new Error('No change: message is missing, not unresolved, or its retry payload expired.');
    console.log('Decision recorded. This command sends nothing; the next tick applies all suppression checks.');
  } else console.log(JSON.stringify(await messageReport(store.raw), null, 2));
} finally { await store.close(); }
