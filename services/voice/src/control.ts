import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { config } from './config.ts';
import { log } from './log.ts';
import { loadScript } from './script.ts';
import { openStore } from './store/index.ts';
import { PostgresStore } from './store/postgres.ts';
import { Scheduler } from './schedule/scheduler.ts';
import { SpeechifyAgent } from './agent/speechify.ts';
import { openMailer } from './recap/mailer.ts';
import { openSms } from './sms/index.ts';
import { handleReply } from './sms/missed.ts';
import { verifySignature } from './webhook/signature.ts';
import { settleConversation } from './loop/settle.ts';
import { UnreadablePayload } from './webhook/speechify.ts';
import type { LoopDeps } from './loop/deps.ts';

/**
 * The control plane: two endpoints and a health check.
 *
 * Separate from `server.ts`, which holds a websocket open for the length of a
 * call and cannot be anything else. Nothing here is long-lived — a request
 * arrives, something is written down, the request ends — so this is the half
 * that survives whichever way the voice vendor question lands.
 */
const MAX_BODY = 1_000_000;

/** The bytes as they arrived. Re-serialising breaks every signature. */
async function rawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

export function controlPlane(deps: LoopDeps, secret = config.speechify.webhookSecret()): Server {
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');

      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

      if (req.method === 'POST' && url.pathname === '/webhooks/speechify') {
        const body = await rawBody(req);
        const verdict = verifySignature(req.headers['speechify-signature'] as string | undefined, body, secret);
        if (!verdict.ok) {
          // Never say which check failed. A caller tuning a forgery learns
          // something from "bad timestamp" that it does not learn from 401.
          log('webhook.rejected', { why: verdict.why });
          return send(res, 401, { error: 'unauthorized' });
        }

        try {
          const out = await settleConversation(JSON.parse(body.toString('utf8')), deps);
          return send(res, 200, out);
        } catch (e) {
          if (e instanceof UnreadablePayload) {
            // 500 so it is retried and noticed. A 200 here would mean a call
            // quietly recorded as never having happened.
            log('webhook.unreadable', { why: e.message });
            return send(res, 500, { error: 'unreadable payload' });
          }
          throw e;
        }
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/sms') {
        const body = await rawBody(req);
        const form = new URLSearchParams(body.toString('utf8'));
        const from = form.get('From');
        const text = form.get('Body');
        if (!from || !text) return send(res, 400, { error: 'missing From or Body' });

        const caller = await deps.store.load(from);
        if (!caller.callNumber) return send(res, 200, { handled: false });
        const slot = await deps.scheduler.slotFor(from);
        if (!slot) return send(res, 200, { handled: false, why: 'no slot' });

        const out = await handleReply(from, text, slot, deps);
        return send(res, 200, { action: out.action });
      }

      return send(res, 404, { error: 'not found' });
    })().catch((e: Error) => {
      log('control.error', { message: e.message });
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  });
}

/** Everything the loop needs, from the environment. */
export function openDeps(): LoopDeps {
  const store = openStore();
  if (!(store instanceof PostgresStore)) {
    throw new Error('The control plane needs DATABASE_URL: a file store cannot turn a hash back into a number.');
  }
  return {
    store,
    scheduler: new Scheduler(store.raw),
    agent: new SpeechifyAgent(config.speechify.apiKey(), config.speechify.agentId()),
    mailer: openMailer(),
    sms: openSms(),
    script: loadScript(),
  };
}
