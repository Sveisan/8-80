import type postgres from 'postgres';
export type Database = postgres.Sql | postgres.TransactionSql;
/** A transaction-bound service uses a savepoint instead of opening another connection. */
export async function transaction<T>(sql: Database, work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return ('savepoint' in sql ? await sql.savepoint(work) : await sql.begin(work)) as T;
}
