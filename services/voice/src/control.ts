import { countRequest } from './journey/measure.ts';
import twilio from 'twilio';
import { randomUUID } from 'node:crypto';
import { queued, enqueue, dispatchMessage } from './messages/outbox.ts';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, repoRoot } from './config.ts';
import { log } from './log.ts';
import { loadScript } from './script.ts';
import { openStore } from './store/index.ts';
import { needsOnboarding } from './store/types.ts';
import { PostgresStore, phoneKey } from './store/postgres.ts';
import { Scheduler } from './schedule/scheduler.ts';
import { SpeechifyAgent } from './agent/speechify.ts';
import { openMailer } from './recap/mailer.ts';
import { openSms } from './sms/index.ts';
import { handleReply } from './sms/missed.ts';
import { verifySignature } from './webhook/signature.ts';
import { Links } from './link/token.ts';
import { contactNumber, vcard } from './link/vcard.ts';
import { BROWSER, FRESH_MS, clearBrowser, clearMemory, cookieOf, crossSite } from './link/cookie.ts';
import {
  confirmForgetPage,
  confirmBillingPage,
  confirmStopPage,
  donePage,
  exportFailedPage,
  forgottenPage,
  gonePage,
  reschedulePage,
  unknownBrowserPage,
  GOALS_MAX,
  type PageView,
} from './link/page.ts';
import { accountState } from './link/account.ts';
import { readMemory, correctMemory } from './memory/context.ts';
import { memoryPage } from './memory/page.ts';
import { accessRoutes } from './access/routes.ts';
import { signupRoutes } from './signup/routes.ts';
import { ANSWER_MAX, isPreview, openFeedback, saveFeedback } from './feedback/feedback.ts';
import { feedbackGonePage, feedbackPage, feedbackThanksPage } from './feedback/page.ts';
import { EMAIL } from './signup/form.ts';
import { legalPage } from './legal/page.ts';
import { composeExport } from './legal/export.ts';
import { syncBilling, cancelRenewal, deleteAccount, customerPortal } from './billing/service.ts';
import { parseReply } from './sms/reply.ts';
import { checkoutLink, billingHome, payments } from './billing/notice.ts';
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

/** Only the local reverse proxy may supply the last forwarded hop. */
const clientOf = (req: IncomingMessage): string => {
  const peer = req.socket.remoteAddress ?? 'unknown';
  const localProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer);
  const forwarded = req.headers['x-forwarded-for'];
  const last = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined;
  return localProxy && last && isIP(last) ? last : peer;
};

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

const html = (res: ServerResponse, status: number, body: string, headers: Record<string, string | string[]> = {}): void => {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    // The link is in somebody's messages. It should not also be in a cache.
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    ...headers,
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
  // Through the parser like everything else, so the button and the text word
  // cannot come to mean different things. 'stop' alone only asks the question
  // — see the handler.
  if (action === 'stop-confirm') return 'stop';
  if (action === 'start') return 'start';
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

      // HEAD as well as GET, because every uptime monitor ever written asks
      // with HEAD and ours answered all of them with a 404. It went unnoticed
      // because `curl -I` is also how a person checks by hand — so the one
      // command somebody reaches for to ask "is it up" was the one command
      // guaranteed to say no.
      if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
        if (req.method === 'HEAD') {
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end();
        }
        return send(res, 200, { ok: true });
      }

      if (req.method === 'GET' && (url.pathname === '/terms' || url.pathname === '/privacy')) {
        return html(res, 200, legalPage(url.pathname.slice(1) as 'terms' | 'privacy'));
      }

      // A browser that signed up goes to its own page rather than the form it
      // already filled in. Only the bare address: /start is always the form,
      // so whoever else uses this browser can still sign themselves up.
      if (req.method === 'GET' && url.pathname === '/' && cookieOf(req, BROWSER)) {
        const opened = await new Links(deps.store.raw).open(cookieOf(req, BROWSER) as string, new Date(), 'browser');
        if (opened.ok) {
          res.writeHead(303, { location: '/me', 'cache-control': 'no-store' });
          return res.end();
        }
      }

      if (url.pathname === '/access' || url.pathname === '/access/verify') {
        const answer = await accessRoutes(req, url, deps, clientOf(req));
        if (answer) return html(res, answer.status, answer.body, answer.headers);
      }

      if (url.pathname === '/' || url.pathname.startsWith('/start')) {
        const answer = await signupRoutes(req, url, deps, clientOf(req));
        if (answer) return html(res, answer.status, answer.body, answer.headers);
        if (req.method === 'GET' && url.pathname === '/') return html(res, 303, '', { location: '/access' });
        return send(res, 404, { error: 'not found' });
      }

      // The recap's letterhead. Deliberately not logged: a request for it is
      // somebody opening their email, and that is not ours to keep.
      if (req.method === 'GET' && url.pathname === '/mark.png') return mark(res);

      // The contact card. The same for everybody and holds nothing about
      // anyone, so it needs no link — and is served as an attachment, which is
      // what makes iOS open "Add contact" rather than show a page of text.
      if (req.method === 'GET' && url.pathname === '/contact.vcf') {
        const number = contactNumber();
        if (!number) return send(res, 404, { error: 'not found' });
        res.writeHead(200, {
          'content-type': 'text/vcard; charset=utf-8',
          'content-disposition': 'attachment; filename="8and80.vcf"',
          'cache-control': 'public, max-age=3600',
        });
        return void res.end(vcard(deps.script, number, config.link.publicUrl() || undefined));
      }

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

      // Two paths, one handler. /webhooks/payments is the name; the other is
      // the one already configured in a vendor's dashboard, and a URL that
      // somebody has to go and change is a URL that will be wrong for a week.
      if (req.method === 'POST' && (url.pathname === '/webhooks/payments' || url.pathname === '/webhooks/lemonsqueezy')) {
        const vendor = payments();
        const raw = await rawBody(req);
        const verdict = vendor.verify(req.headers, raw, config.billing.webhookSecret());
        if (!verdict.ok) {
          log('billing.rejected', { vendor: vendor.name, why: verdict.why });
          return send(res, 401, { error: 'unauthorized' });
        }
        let payload: unknown;
        try {
          payload = JSON.parse(raw.toString('utf8'));
        } catch {
          return send(res, 400, { error: 'not json' });
        }
        const read = vendor.read(req.headers, payload);
        if (!read.ok) {
          // Ignore unrelated events without logging customer data.
          log('billing.unreadable', { vendor: vendor.name, why: read.why, shape: read.shape });
          return send(res, 200, { handled: false });
        }
        let applied;
        try { applied = await syncBilling(deps, read.change); }
        catch { log('billing.sync_failed', { vendor: vendor.name }); return send(res, 503, { error: 'billing confirmation pending' }); }
        log('billing.event', {
          vendor: vendor.name,
          event: read.change.event,
          status: read.change.status ?? 'none',
          standing: read.change.standing ?? 'none',
          matched: applied.matched,
          from: applied.from ?? 'none',
        });
        return send(res, 200, { handled: applied.matched });
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/sms') {
        const body = await rawBody(req);
        const form = new URLSearchParams(body.toString('utf8'));
        const signature = req.headers['x-twilio-signature'];
        const token = process.env['TWILIO_AUTH_TOKEN'];
        const base = config.link.publicUrl().replace(/\/$/, '');
        // The webhook can live on api.example while controls live on example.
        // Never infer the signed origin from untrusted proxy headers.
        const signedUrl = process.env['TWILIO_SMS_WEBHOOK_URL'] || (base ? `${base}${req.url}` : '');
        if (!token || !signedUrl || typeof signature !== 'string' || !twilio.validateRequest(token, signature, signedUrl, Object.fromEntries(form))) return send(res, 403, { error: 'unverified SMS' });
        const smsAck = (): void => { res.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' }); res.end('<Response/>'); };
        const from = form.get('From');
        const text = form.get('Body');
        if (!from || !text) return send(res, 400, { error: 'missing From or Body' });
        const sid = form.get('MessageSid') ?? '';
        if (!/^SM[a-zA-Z0-9_]{1,64}$/.test(sid)) return send(res, 400, { error: 'missing message identity' });
        const hash = phoneKey(from);
        const scope = `reply:${sid}`;
        const [previous] = await deps.store.raw`select id from message_outbox where event_key = ${`${scope}:sms`}`;
        if (previous) { await dispatchMessage(deps, previous['id']); return smsAck(); }

        const caller = await deps.store.load(from);
        if (!caller.callNumber) return smsAck();
        const intent = parseReply(text);
        if (intent.kind === 'cancel_subscription') {
          let key: string;
          try { key = await cancelRenewal(deps, phoneKey(from)) === 'cancelled' ? 'sms.subscription.cancelled' : 'sms.subscription.none'; }
          catch { key = 'sms.subscription.failed'; }
          const id = await deps.store.raw.begin(async tx => {
            const [caller] = await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
            if (!caller) return undefined;
            return enqueue(tx, { eventKey: `${scope}:sms`, phoneHash: hash, channel: 'sms', kind: 'reply', to: from,
              body: (deps.script.get(key) ?? '').replace('{{link}}', billingHome() || `mailto:${config.company.supportEmail() || 'hei@8and80.me'}`) });
          });
          if (id) await dispatchMessage(deps, id);
          return smsAck();
        }
        const slot = await deps.scheduler.slotFor(from);
        if (!slot) return smsAck();
        const ids = await deps.store.raw.begin(async tx => {
          const [current] = await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
          if (!current || (await tx`select id from message_outbox where event_key = ${`${scope}:sms`}`).length) return [];
          if (intent.kind === 'start' || intent.kind === 'stop') await tx`update callers set sms_opt_out = ${intent.kind === 'stop'} where phone_hash = ${hash}`;
          const messages = queued(tx, hash, scope, new Date(), 'reply');
          await handleReply(from, text, slot, { ...deps, scheduler: new Scheduler(tx), sms: messages.sms });
          return messages.ids;
        });
        for (const id of ids) await dispatchMessage(deps, id);
        return smsAck();
      }

      // The page a text points at. No login: asking somebody to remember a
      // password in order to move a phone call is how a courtesy becomes a
      // chore. The token is what limits the damage — see link/token.ts.
      if (url.pathname.startsWith('/r/')) {
        if (req.method === 'POST' && crossSite(req)) return send(res, 403, { error: 'forbidden' });
        const opened = await new Links(deps.store.raw).open(decodeURIComponent(url.pathname.slice(3)));
        if (!opened.ok) {
          log('link.refused', { why: opened.why });
          return html(res, 410, gonePage(deps.script));
        }
        return await yourPage(req, res, deps, opened.claims.phoneHash, 'link');
      }

      // The one feedback form, from the one feedback text. Same kind of code
      // as every other link, and its own purpose, so it opens nothing else.
      if (url.pathname.startsWith('/f/')) {
        const opened = await new Links(deps.store.raw).open(decodeURIComponent(url.pathname.slice(3)), new Date(), 'feedback');
        if (!opened.ok) {
          log('feedback.refused', { why: opened.why });
          return html(res, 410, feedbackGonePage(deps.script));
        }
        const hash = opened.claims.phoneHash;
        if (req.method === 'POST') {
          const form = new URLSearchParams((await rawBody(req)).toString('utf8'));
          const get = (k: string): string => (form.get(k) ?? '').trim().slice(0, ANSWER_MAX);
          // Never the content, here or anywhere: only that it happened.
          const saved = await saveFeedback(deps.store.raw, hash, { pickup: get('pickup'), nearly: get('nearly'), else: get('else') });
          log('feedback.submitted', { saved });
          return html(res, saved ? 200 : 410, saved ? feedbackThanksPage(deps.script) : feedbackGonePage(deps.script));
        }
        const answers = await openFeedback(deps.store.raw, hash, !isPreview(req.headers['user-agent']));
        if (!answers) return html(res, 410, feedbackGonePage(deps.script));
        return html(res, 200, feedbackPage(deps.script, answers));
      }

      if (url.pathname === '/memory') {
        if (req.method === 'POST' && crossSite(req)) return send(res, 403, { error: 'forbidden' });
        const code = cookieOf(req, 'memory');
        const opened = code ? await new Links(deps.store.raw).open(code, new Date(), 'memory') : undefined;
        if (!opened?.ok) return html(res, 303, '', { location: '/access?for=memory', 'set-cookie': clearMemory() });
        const hash = opened.claims.phoneHash;
        let current = await readMemory(deps.store.raw, hash);
        if (!current) return html(res, 410, gonePage(deps.script), { 'set-cookie': clearMemory() });
        if (req.method === 'GET') return html(res, 200, memoryPage(current, deps.script));
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
        const form = new URLSearchParams((await rawBody(req)).toString('utf8'));
        if (form.get('action') === 'done') {
          await deps.store.raw`delete from links where code = ${code!} and purpose = 'memory'`;
          return html(res, 303, '', { location: '/me', 'set-cookie': clearMemory() });
        }
        if (form.get('action') !== 'save') return html(res, 400, memoryPage(current, deps.script));
        const commitment = (form.get('commitment') ?? '').trim();
        const goals = (form.get('goals') ?? '').trim();
        if (commitment.length > 2000 || goals.length > 2000) return html(res, 400, memoryPage(current, deps.script, 'memory.long'));
        const result = await correctMemory(deps.store.raw, hash, form.get('revision') ?? '', commitment, goals);
        current = await readMemory(deps.store.raw, hash);
        if (!current) return html(res, 410, gonePage(deps.script), { 'set-cookie': clearMemory() });
        log('caller.memory_correction', { result });
        return html(res, result === 'saved' ? 200 : 409, memoryPage(current, deps.script, result === 'saved' ? 'memory.saved' : 'memory.changed'));
      }

      // The same page, for the browser that signed up. See BROWSER below for
      // what this is and why it is not a login.
      if (url.pathname === '/me') {
        const code = cookieOf(req, BROWSER);
        const opened = code ? await new Links(deps.store.raw).open(code, new Date(), 'browser') : undefined;
        if (!opened?.ok) {
          if (opened) log('browser.refused', { why: opened.why });
          // Forgotten on our side, so forgotten on theirs: a dead cookie left
          // in place is a dead cookie sent with every request for a week.
          return html(res, 200, unknownBrowserPage(deps.script), code ? { 'set-cookie': clearBrowser() } : {});
        }
        if (req.method === 'POST' && crossSite(req)) return send(res, 403, { error: 'forbidden' });
        const fresh = Date.now() - opened.claims.issuedAt.getTime() < FRESH_MS;
        return await yourPage(req, res, deps, opened.claims.phoneHash, 'browser', fresh);
      }

      return send(res, 404, { error: 'not found' });
    })().catch((e: Error) => {
      log('control.error', { message: e.message });
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  });
}

/**
 * The page, for whoever proved they may see it — by a link from a text, or by
 * being the browser that signed up. One handler for both, so the two ways in
 * cannot come to offer different things by accident; the one deliberate
 * difference is `via`, which keeps the copy and the deletion link-only.
 */
async function yourPage(
  req: IncomingMessage,
  res: ServerResponse,
  deps: LoopDeps,
  phoneHash: string,
  via: 'link' | 'browser',
  fresh = false,
): Promise<void> {
  const phone = await deps.store.phoneFor(phoneHash);
  const slot = phone ? await deps.scheduler.slotFor(phone) : undefined;
  if (!phone || !slot) return html(res, 410, via === 'link' ? gonePage(deps.script) : unknownBrowserPage(deps.script));
  const caller = await deps.store.load(phone);
  const language = caller.language;
  const back = new URL(req.url ?? '/me', 'http://local').pathname;

  // No call yet: the page is about the first one. `callNumber` 1 is "never
  // been called"; a rehearsal is a first call on purpose and says so too.
  const before = needsOnboarding(caller);
  const view = async (extra: Partial<PageView> = {}): Promise<PageView> => {
    const account = await accountState(deps.store.raw, phoneHash);
    const next = account?.next;
    return {
      via,
      account,
      beforeFirst: before,
      // Until there has been a call there is no list to add to — the first
      // call makes it, and does not read anything added before.
      goals: !before,
      // Before the first call, so the first ring already has a name on it.
      contact: before && !!contactNumber(),
      ...(next ? { next, ...(before ? { first: next } : {}) } : {}),
      ...extra,
    };
  };
  const page = async (email?: string, note?: string, extra: Partial<PageView> = {}): Promise<void> =>
    html(res, 200, reschedulePage(slot, deps.script, language, email ?? caller.email, note, await view(extra)));

  if (req.method === 'GET') {
    await countRequest(deps.store.raw, 'controls_loaded');
    const query = new URL(req.url ?? '/me', 'http://local').searchParams;
    let billingNote: string | undefined;
    if (query.get('billing') === 'return') {
      const [record] = await deps.store.raw`select ls_subscription_id, billing_provider from callers where phone_hash = ${phoneHash}`;
      if (record?.['ls_subscription_id']) {
        try { await syncBilling(deps, { event: 'account.return', phoneHash, subscriptionId: record['ls_subscription_id'], provider: record['billing_provider'] ?? config.billing.provider() }); billingNote = 'page.billing.checked'; }
        catch { billingNote = 'page.billing.pending'; }
      } else billingNote = 'page.billing.pending';
    }
    return await page(undefined, undefined, { fresh, scheduleNote: query.get('welcome') === 'unavailable' ? 'page.welcome.unavailable' : billingNote });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const form = new URLSearchParams((await rawBody(req)).toString('utf8'));
  const action = form.get('action');
  await countRequest(deps.store.raw, 'control_submitted');
  const measured = (success: boolean) => countRequest(deps.store.raw, success ? 'control_applied' : 'control_not_applied');
  const state = await accountState(deps.store.raw, phoneHash);
  if (!state) return html(res, 410, gonePage(deps.script));
  // A stale page must not resume paused calls by changing their weekly slot.
  if (['start', 'move', 'skip', 'later'].includes(action ?? '') &&
      (!state.canCall || (state.paused && action !== 'start'))) return await page();
  // Asked, not done. The only control here that a mis-tap should not be able
  // to end the arrangement with.
  if (action === 'feedback-on' || action === 'feedback-off') {
    await deps.store.raw`update callers set feedback_opt_out = ${action === 'feedback-off'} where phone_hash = ${phoneHash}`;
    await measured(true);
    return await page(undefined, undefined, { scheduleNote: 'page.feedback.saved' });
  }
  if (action === 'stop') return html(res, 200, confirmStopPage(deps.script, language));

  // The two that hand over or destroy everything. Only from a link that
  // arrived on their phone; a browser that remembers them is not enough.
  if (via === 'browser' && (action === 'export' || action === 'forget' || action === 'forget-confirm' || action === 'billing-portal' || action === 'cancel-renewal' || action === 'cancel-renewal-confirm')) {
    log('browser.refused', { why: `${action} needs a link` });
    return await page();
  }
  if (action === 'checkout') {
    if (state.subscribed && state.billing !== 'ended') return await page();
    const link = checkoutLink(phoneHash, caller.email);
    return link ? html(res, 303, '', { location: link }) : await page(undefined, undefined, { scheduleNote: 'page.billing.unavailable' });
  }
  if (action === 'billing-portal') {
    try { return html(res, 303, '', { location: await customerPortal(deps, phoneHash) }); }
    catch { return await page(undefined, undefined, { scheduleNote: 'page.billing.unavailable' }); }
  }
  if (action === 'cancel-renewal') return html(res, 200, confirmBillingPage(deps.script, 'cancel-renewal-confirm', back));
  if (action === 'cancel-renewal-confirm') {
    try { const result = await cancelRenewal(deps, phoneHash); await measured(result === 'cancelled'); return await page(undefined, undefined, { scheduleNote: result === 'none' ? 'page.cancel.none' : 'page.cancel.saved' }); }
    catch { await measured(false); return await page(undefined, undefined, { scheduleNote: 'page.cancel.failed' }); }
  }
  if (action === 'forget') return html(res, 200, confirmForgetPage(deps.script, language));
  if (action === 'export') {
    // To the address the recaps go to, and nowhere else. This page is
    // reachable by whoever is holding the phone, so a form that could send
    // somebody's record to an address typed into it would not be a data
    // export, it would be a way to read a stranger's week.
    const sent = await emailEverything(deps, phone, caller.email);
    await measured(sent);
    return html(res, sent ? 200 : 503, sent ? donePage(deps.script.get('page.export.sent') ?? '', deps.script, language, back) : exportFailedPage(deps.script, language, back));
  }
  if (action === 'email') {
    // The one thing a call cannot take: an address spelled out loud.
    // SCRIPT.md §7 — a Norwegian name letter by letter down a phone line cost
    // one call ninety seconds and still got it wrong.
    //
    // No verification mail. The link that opened this page was sent to their
    // number, which is what this product treats as identity; an address is
    // where a letter goes, not a way in. Getting it wrong costs one recap and
    // is fixed by typing it again.
    const typed = (form.get('email') ?? '').trim();
    if (!EMAIL.test(typed)) return await page(caller.email, 'page.email.bad');
    await deps.store.upsertProfile(phone, { email: typed });
    await measured(true);
    log('caller.email_set', {});
    return await page(typed, 'page.email.saved');
  }
  if (action === 'goals') {
    // Added to what the first call wrote down, never shown back: this page
    // opens for whoever has the link, and the list is theirs. SCRIPT.md §19.
    const line = (form.get('goals') ?? '').replace(/\s+/g, ' ').trim().slice(0, GOALS_MAX);
    if (before || !line) return await page();
    const added = await (deps.store as PostgresStore).addToGoals(phone, line);
    await measured(added === 'added');
    log('caller.goals_added', { outcome: added });
    return await page(undefined, undefined, { goalsNote: added === 'added' ? 'page.goals.saved' : 'page.goals.full' });
  }
  if (action === 'stop-cancel') return await page();
  if (action === 'forget-confirm') {
    try { await deleteAccount(deps, phone, phoneHash); }
    catch { return await page(undefined, undefined, { scheduleNote: 'page.forget.failed' }); }
    await measured(true);
    log('caller.forgotten', {});
    return html(res, 200, forgottenPage(deps.script, language));
  }
  // Old pages may still submit “later”. Show the time picker rather than
  // treating that vague request as permission to pick an hour for them.
  if (action === 'later' || (action === 'skip' && before)) return await page();

  let skipAt: Date | undefined;
  if (action === 'skip') {
    const value = form.get('skip_at') ?? '';
    skipAt = new Date(value);
    // A legacy or malformed form has no named occurrence to cancel.
    if (!Number.isFinite(skipAt.getTime()) || skipAt.toISOString() !== value) return await page();
  }

  const said = phraseFor(form);
  if (!said) return await page();
  // Straight through the same path a text would take, so the two ways of
  // moving a call cannot drift apart.
  const out = await handleReply(phone, said, slot, { ...deps, sms: silent }, new Date(), { skipAt, language });
  await measured(['moved', 'moved_always', 'skipped', 'stopped', 'started'].includes(out.action));
  // Re-render persisted state after pause/resume, so a revisit shows the same
  // result. Recovery remains available if the credential later expires.
  if (out.action === 'stopped') return await page();
  if (out.action === 'started') return await page();
  if (out.action === 'unchanged' && action === 'move') return await page(undefined, undefined, { scheduleNote: 'page.move.unavailable' });
  return html(res, 200, donePage(out.said, deps.script, language, back));
}

/**
 * A copy of everything, to the address already on file.
 *
 * Return the send result so the page can distinguish completion from failure.
 */
async function emailEverything(deps: LoopDeps, phone: string, email: string | undefined): Promise<boolean> {
  try {
    if (!email) return false;
    const id = await deps.store.raw.begin(async tx => {
      const hash = phoneKey(phone);
      const [caller] = await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
      if (!caller) return undefined;
      const letter = await composeExport(deps.store.in(tx), phone, deps.script);
      if (!letter) return undefined;
      return enqueue(tx, { eventKey: `export:${randomUUID()}`, phoneHash: hash, channel: 'email', kind: 'export', to: email, body: letter });
    });
    return !!id && await dispatchMessage(deps, id) === 'accepted';
  } catch (e) {
    log('export.failed', { reason: (e as Error).message });
    return false;
  }
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
