import postgres from 'postgres';
import { PostgresStore } from '../../src/store/postgres.ts';
import { applyMigrations } from '../../src/store/migrate.ts';

const URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://eight80:eight80@127.0.0.1:5432/eight80_test';

export interface TestDb {
  sql: postgres.Sql;
  store: PostgresStore;
  close(): Promise<void>;
}

/**
 * A database of one's own, for one test file.
 *
 * node:test runs files in parallel, and every one of these files truncates
 * between tests. Sharing a schema means one file wiping another's rows
 * mid-assertion — and worse, `claimDue` reading callers a different file
 * created, so a test asserting "exactly one call is due" fails for reasons
 * that have nothing to do with the scheduler.
 *
 * A Postgres schema per file fixes it at the source rather than by forcing the
 * runner to be serial, which would work today and break silently the first time
 * somebody turns concurrency back on.
 */
export async function openTestDb(name: string): Promise<TestDb | string> {
  const schema = `t_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
  try {
    const admin = postgres(URL, { max: 1, connect_timeout: 3 });
    await admin`select 1`;
    await admin.unsafe(`drop schema if exists ${schema} cascade`);
    await admin.unsafe(`create schema ${schema}`);
    await admin.end({ timeout: 3 });

    const options = { connection: { search_path: schema } };
    // Its own journal as well as its own schema: drizzle records applied
    // migrations outside search_path, so a shared journal would tell the second
    // schema everything was already done and leave it empty.
    await applyMigrations(URL, undefined, options, schema);

    const sql = postgres(URL, { max: 4, ...options });
    const store = new PostgresStore(URL, options);
    return {
      sql,
      store,
      close: async () => {
        await store.close();
        await sql.end({ timeout: 3 });
      },
    };
  } catch (e) {
    return `no database at ${URL} (${(e as Error).message}) — start one or set TEST_DATABASE_URL`;
  }
}
