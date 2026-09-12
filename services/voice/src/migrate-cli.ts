import { config } from './config.ts';
import { applyMigrations } from './store/migrate.ts';

/** npm run db:migrate — apply every pending migration, then say so and stop. */
const url = process.env['DATABASE_URL'] ?? config.database.url;
if (!url) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}
await applyMigrations(url);
console.log('Migrations applied.');
