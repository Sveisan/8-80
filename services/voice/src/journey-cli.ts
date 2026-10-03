import { config } from './config.ts';
import { PostgresStore } from './store/postgres.ts';
import { journeyReport } from './journey/measure.ts';
if (!config.database.url) throw new Error('DATABASE_URL is required');
const store = new PostgresStore(config.database.url);
try { console.log(JSON.stringify(await journeyReport(store.raw), null, 2)); }
finally { await store.close(); }
