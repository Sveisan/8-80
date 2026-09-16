import { log } from './log.ts';
import { controlPlane, openDeps } from './control.ts';

/**
 * The webhook listener. Long-running, behind TLS, on a public hostname:
 * Speechify posts conversation.completed here, and the carrier posts inbound
 * texts.
 */
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
