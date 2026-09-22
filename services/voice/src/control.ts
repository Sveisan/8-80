import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, repoRoot } from './config.ts';
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
import { Links } from './link/token.ts';
import { donePage, gonePage, reschedulePage } from './link/page.ts';
import { parseLocalTime } from './schedule/time.ts';
import { settleConversation } from './loop/settle.ts';
import { UnreadablePayload, shapeOf } from './webhook/speechify.ts';
import { Deliveries } from './webhook/deliveries.ts';
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

/**
 * The letterhead image, read once and held.
 *
 * Small, immutable, and requested by every mail client that renders a recap.
 * Reading it from disk per request would be the only filesystem hit in the
 * hot path of a server whose other job is answering a telephony webhook
 * inside its timeout.
 */
let markPng: Buffer | undefined;
const mark = (res: ServerResponse): void => {
  markPng ??= readFileSync(resolve(repoRoot, 'brand', 'assets', 'mark-email.png'));
  res.writeHead(200, {
    'content-type': 'image/png',
    // A year, immutable: the mark does not change, and every fetch of it that
    // does not happen is one fewer record of when somebody opened their email.
    'cache-control': 'public, max-age=31536000, immutable',
    'referrer-policy': 'no-referrer',
  });
  res.end(markPng);
};

const html = (res: ServerResponse, status: number, body: string): void => {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // The link is in somebody's messages. It should not also be in a cache.
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
};

/**
 * The page's buttons, as the sentence a text would have said.
 *
 * Deliberately routed through the same parser. Two ways to move a call that
 * each own their own logic is two things to keep in agreement, and they will
 * not stay in agreement.
 */
function phraseFor(form: URLSearchParams): string | undefined {
  const action = form.get('action');
  if (action === 'later') return 'later';
  if (action === 'skip') return 'skip';
  if (action !== 'move') return undefined;

  const weekday = Number(form.get('weekday'));
  const minute = parseLocalTime(form.get('time') ?? '');
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || minute === undefined) return undefined;

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return `${days[weekday]} ${time}${form.get('always') ? ' always' : ''}`;
}

/**
 * The page already told them what happened, on the page. A text saying the
 * same thing arrives as a second notification about something they just did.
 */
const silent = { send: async (): Promise<void> => undefined };

export function controlPlane(deps: LoopDeps, secret: string | readonly string[] = config.speechify.webhookSecrets()): Server {
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');

      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

      // The recap's letterhead. Deliberately not logged: a request for it is
      // somebody opening their email, and that is not ours to keep.
      if (req.method === 'GET' && url.pathname === '/mark.png') return mark(res);

      if (req.method === 'POST' && url.pathname === '/webhooks/speechify') {
        const body = await rawBody(req);
        const verdict = verifySignature(req.headers['speechify-signature'] as string | undefined, body, secret);
        if (!verdict.ok) {
          // Never say which check failed. A caller tuning a forgery learns
          // something from "bad timestamp" that it does not learn from 401.
          log('webhook.rejected', { why: verdict.why });
          return send(res, 401, { error: 'unauthorized' });
        }

        const event = req.headers['speechify-event'] as string | undefined;

        // Stored before it is understood — the deliveries worth keeping are the
        // ones we cannot read. Kept encrypted and pruned; see the table comment.
        const deliveryId = await deps.deliveries?.record(body, {
          ...(typeof req.headers['speechify-delivery-id'] === 'string'
            ? { deliveryId: req.headers['speechify-delivery-id'] }
            : {}),
          ...(event ? { event } : {}),
        });

        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          log('webhook.not_json', {});
          await deps.deliveries?.verdict(deliveryId, 'not json');
          return send(res, 400, { error: 'not json' });
        }

        try {
          const out = await settleConversation(parsed, deps, event);
          await deps.deliveries?.verdict(deliveryId, out.why ?? out.status ?? 'handled');
          return send(res, 200, out);
        } catch (e) {
          if (e instanceof UnreadablePayload) {
            // 500 so it is retried and noticed. A 200 here would mean a call
            // quietly recorded as never having happened. The shape goes with it:
            // "no conversation_id" says a field is missing, and only the field
            // names say where it actually is. Names and types, never values.
            log('webhook.unreadable', { why: e.message, shape: shapeOf(parsed) });
            await deps.deliveries?.verdict(deliveryId, `unreadable: ${e.message}`);
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

      // The page a missed-call text points at. No login: asking somebody to
      // remember a password in order to move a phone call is how a courtesy
      // becomes a chore. The token is what limits the damage — see link/token.ts.
      if (url.pathname.startsWith('/r/')) {
        const opened = await new Links(deps.store.raw).open(decodeURIComponent(url.pathname.slice(3)));
        if (!opened.ok) {
          log('link.refused', { why: opened.why });
          return html(res, 410, gonePage(deps.script));
        }

        const phone = await deps.store.phoneFor(opened.claims.phoneHash);
        const slot = phone ? await deps.scheduler.slotFor(phone) : undefined;
        if (!phone || !slot) return html(res, 410, gonePage(deps.script));
        const caller = await deps.store.load(phone);

        if (req.method === 'GET') return html(res, 200, reschedulePage(slot, deps.script, caller.language));

        if (req.method === 'POST') {
          const form = new URLSearchParams((await rawBody(req)).toString('utf8'));
          const said = phraseFor(form);
          if (!said) return html(res, 200, reschedulePage(slot, deps.script, caller.language));
          // Straight through the same path a text would take, so the two ways
          // of moving a call cannot drift apart.
          const out = await handleReply(phone, said, slot, { ...deps, sms: silent }, new Date());
          return html(res, 200, donePage(out.said, deps.script, caller.language));
        }
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
    agent: new SpeechifyAgent(
      config.speechify.apiKey(),
      config.speechify.agentId(),
      config.speechify.firstCallAgentId(),
      config.speechify.base,
      config.speechify.send,
    ),
    mailer: openMailer(),
    sms: openSms(),
    script: loadScript(),
    deliveries: new Deliveries(store.raw),
  };
}
