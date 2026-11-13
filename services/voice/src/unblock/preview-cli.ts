import { previewServer } from './preview.ts';
const port = Number(process.env['UNBLOCK_PREVIEW_PORT'] ?? 8771);
const server = previewServer();
// Loopback only: the synthetic walkthrough is never reachable from another machine.
server.listen(port, '127.0.0.1', () => console.log(`Unblock preview: http://127.0.0.1:${port}/unblock — code 000000; no calls, messages or payments.`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
