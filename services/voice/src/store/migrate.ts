import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Apply migrations with the driver we already ship, not with drizzle-kit.
 *
 * drizzle-kit is a dev dependency and a deployment that needs it is a
 * deployment that installs a toolchain to start. The SQL in drizzle/ is
 * generated at development time and applied at runtime, so the Norwegian box
 * needs Node and nothing else.
 */
export async function applyMigrations(url: string, folder = resolve(import.meta.dirname, '../../drizzle')): Promise<void> {
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end({ timeout: 5 });
  }
}
