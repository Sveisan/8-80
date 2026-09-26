import { readFileSync } from 'node:fs';
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

/**
 * Migrations in the repository that the database has not been given.
 *
 * Twice now, code has been deployed ahead of its schema: a pull brings a new
 * migration and a column the running code reads, the service restarts, and
 * every settle throws `column does not exist` on the first caller of the
 * morning. Both times the evidence arrived a day later, from a person
 * wondering why their call had not happened.
 *
 * Drizzle stores the journal's `when` for each applied migration, so the
 * comparison is exact rather than a count — a database that skipped one in the
 * middle is caught as surely as one that is simply behind.
 *
 * Returns the tags, newest last. An unreachable database throws; the caller
 * decides whether that is fatal, because at startup it is and in a diagnostic
 * it is one line of a report.
 */
export async function pendingMigrations(
  url: string,
  folder = resolve(import.meta.dirname, '../../drizzle'),
  options: postgres.Options<Record<string, never>> = {},
): Promise<string[]> {
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { when: number; tag: string }[];
  };
  const client = postgres(url, { max: 1, ...options });
  try {
    const rows = await client<{ created_at: string }[]>`
      select created_at from drizzle.__drizzle_migrations
    `.catch(() => []);
    const applied = new Set(rows.map((r) => Number(r.created_at)));
    return journal.entries.filter((e) => !applied.has(e.when)).map((e) => e.tag);
  } finally {
    await client.end({ timeout: 5 });
  }
}
