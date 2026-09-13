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
export async function applyMigrations(
  url: string,
  folder = resolve(import.meta.dirname, '../../drizzle'),
  options: postgres.Options<Record<string, never>> = {},
  /**
   * Where the record of applied migrations lives. It defaults to drizzle's own
   * schema, which is deliberately independent of `search_path` — so two
   * databases-within-a-database sharing this journal will have the second one
   * told its migrations are already applied, and it will come up with no
   * tables at all. That is only a problem for tests, and it is their job to
   * pass a journal of their own.
   */
  migrationsSchema?: string,
): Promise<void> {
  const client = postgres(url, { max: 1, ...options });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: folder,
      ...(migrationsSchema ? { migrationsSchema } : {}),
    });
  } finally {
    await client.end({ timeout: 5 });
  }
}
