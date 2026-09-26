import { log } from './log.ts';
import { config } from './config.ts';
import { controlPlane, openDeps } from './control.ts';
import { pendingMigrations } from './store/migrate.ts';

/**
 * The webhook listener. Long-running, behind TLS, on a public hostname:
 * Speechify posts conversation.completed here, and the carrier posts inbound
 * texts.
 */
/**
 * Refuse to serve a database that is behind the code.
 *
 * Deployed twice now with a migration unapplied, and both times the service
 * came up healthy and then threw on the first real caller — a failure that
 * looks like nothing until somebody's weekly call does not happen. A process
 * that will not start is visible in `systemctl status` within a second; a
 * process that serves five hundreds is visible tomorrow.
 *
 * Only pending migrations stop it. An unreachable database at this moment is
 * not made better by refusing to run: the store retries, and a control plane
 * that gives up because Postgres was slow to accept one connection is a worse
 * failure than the one being prevented.
 */
const behind = await pendingMigrations(config.database.url).catch(() => []);
if (behind.length) {
  log('control.schema_behind', {
    pending: behind.join(', '),
    note: 'the database is missing migrations this code needs. Run: npm run db:migrate',
  });
  process.exit(1);
}

const deps = openDeps();
const port = Number(process.env['CONTROL_PORT'] ?? 8080);
const server = controlPlane(deps);

server.listen(port, () => log('control.listening', { port }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Finish the request in flight; a webhook cut off mid-settle is the one
    // that leaves an attempt stuck in `settling`.
    server.close(() => void deps.store.close().then(() => process.exit(0)));
  });
}
