import postgres from 'postgres';
import { config } from '../config.ts';
import { reviewCompletedCalls, workerConfig } from './worker.ts';
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--status')) {
  console.error('Use quality:jev:worker [--status]. No private source data is printed.'); process.exitCode = 1;
} else {
  const sql = postgres(config.database.url, { max: 1, connect_timeout: 3, connection: { statement_timeout: 5000 } });
  try {
    if (args[0] === '--status') {
      const settings = workerConfig();
      const rows = await sql`select state, count(*)::int as count from jev_quality_reviews group by state order by state`;
      console.log(JSON.stringify({ enabled: settings.enabled, cutoverConfigured: !!settings.startedAt,
        keyConfigured: !!settings.apiKey?.trim(), reviews: rows }));
    } else console.log(JSON.stringify(await reviewCompletedCalls(sql, workerConfig())));
  } catch { console.error('Jev worker status unavailable. No private data or configuration was printed.'); process.exitCode = 1; }
  finally { await sql.end({ timeout: 5 }); }
}
