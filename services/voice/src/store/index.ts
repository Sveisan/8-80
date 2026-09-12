import { config } from '../config.ts';
import { log } from '../log.ts';
import { FileStore } from './file.ts';
import { PostgresStore } from './postgres.ts';
import type { Store } from './types.ts';

export type { CallerRecord, CallOutcome, Store } from './types.ts';
export { FileStore } from './file.ts';
export { PostgresStore, phoneKey } from './postgres.ts';
export { applyMigrations } from './migrate.ts';

/**
 * Postgres when DATABASE_URL is set, files when it is not.
 *
 * The choice is logged rather than silent, because "why did last week vanish"
 * is answered by knowing which of the two the last call wrote to.
 */
export function openStore(url = config.database.url): Store {
  if (!url) {
    log('store.open', { kind: 'file', note: 'DATABASE_URL is unset — this is development storage' });
    return new FileStore();
  }
  log('store.open', { kind: 'postgres' });
  return new PostgresStore(url);
}
