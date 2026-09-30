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
import { BROWSER, FRESH_MS, clearBrowser, cookieOf, crossSite } from './link/cookie.ts';
import {
  confirmForgetPage,
  confirmStopPage,
  donePage,
  forgottenPage,
  gonePage,
  reschedulePage,
  stoppedPage,
  unknownBrowserPage,
  GOALS_MAX,
  type PageView,
} from './link/page.ts';
import { signupRoutes } from './signup/routes.ts';
import { ANSWER_MAX, isPreview, openFeedback, saveFeedback } from './feedback/feedback.ts';
import { feedbackGonePage, feedbackPage, feedbackThanksPage } from './feedback/page.ts';
import { EMAIL } from './signup/form.ts';
import { legalPage } from './legal/page.ts';
import { composeExport } from './legal/export.ts';
import { checkoutLink, composePaymentFailed, payments } from './billing/notice.ts';
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

/**
 * Who is asking, for rate limiting only.
 *
 * Behind a reverse proxy the socket address is the proxy, so the forwarded
 * header is read first — and only the first hop of it, because everything
 * after that was written by the client and a limiter keyed on a value the
 * client controls is not a limiter.
 */
const clientOf = (req: IncomingMessage): string => {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
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

const html = (res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void => {
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

      if (url.pathname === '/' || url.pathname.startsWith('/start')) {
        const answer = await signupRoutes(req, url, deps, clientOf(req));
        if (answer) return html(res, answer.status, answer.body, answer.headers);
        return send(res, 404, { error: 'not found' });
      }

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
          // The shape, not the contents. Both adapters were written without
          // access to the vendor's documentation, so the first real delivery
          // is the documentation — and a 200 keeps them from retrying
          // something we already have.
          log('billing.unreadable', { vendor: vendor.name, why: read.why, shape: read.shape });
          return send(res, 200, { handled: false });
        }
        const applied = await (deps.store as PostgresStore).applyBilling(read.change);
        log('billing.event', {
          vendor: vendor.name,
          event: read.change.event,
          status: read.change.status ?? 'none',
          standing: read.change.standing ?? 'none',
          matched: applied.matched,
          from: applied.from ?? 'none',
        });
        // On the transition only. Their dunning re-sends this for days, and a
        // second voice chasing the same card is what makes somebody cancel out
        // of irritation rather than intent.
        if (applied.matched && read.change.standing === 'past_due' && applied.from !== 'past_due') {
          await tellThemTheCardFailed(deps, applied.phoneHash as string);
        }
        return send(res, 200, { handled: applied.matched });
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

      // The page a text points at. No login: asking somebody to remember a
      // password in order to move a phone call is how a courtesy becomes a
      // chore. The token is what limits the damage — see link/token.ts.
      if (url.pathname.startsWith('/r/')) {
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

  // No call yet: the page is about the first one. `callNumber` 1 is "never
  // been called"; a rehearsal is a first call on purpose and says so too.
  const before = caller.callNumber <= 1 || !!caller.rehearseFirstCall;
  const view = async (extra: Partial<PageView> = {}): Promise<PageView> => {
    const next = before ? await deps.scheduler.nextCallFor(phone) : undefined;
    return {
      via,
      // Until there has been a call there is no list to add to — the first
      // call makes it, and does not read anything added before.
      goals: !before,
      ...(next ? { first: next } : {}),
      ...extra,
    };
  };
  const page = async (email?: string, note?: string, extra: Partial<PageView> = {}): Promise<void> =>
    html(res, 200, reschedulePage(slot, deps.script, language, email, note, await view(extra)));

  if (req.method === 'GET') return await page(undefined, undefined, { fresh });
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

  const form = new URLSearchParams((await rawBody(req)).toString('utf8'));
  const action = form.get('action');
  // Asked, not done. The only control here that a mis-tap should not be able
  // to end the arrangement with.
  if (action === 'stop') return html(res, 200, confirmStopPage(deps.script, language));

  // The two that hand over or destroy everything. Only from a link that
  // arrived on their phone; a browser that remembers them is not enough.
  if (via === 'browser' && (action === 'export' || action === 'forget' || action === 'forget-confirm')) {
    log('browser.refused', { why: `${action} needs a link` });
    return await page();
  }
  if (action === 'forget') return html(res, 200, confirmForgetPage(deps.script, language));
  if (action === 'export') {
    // To the address the recaps go to, and nowhere else. This page is
    // reachable by whoever is holding the phone, so a form that could send
    // somebody's record to an address typed into it would not be a data
    // export, it would be a way to read a stranger's week.
    await emailEverything(deps, phone, caller.email);
    return html(res, 200, donePage(deps.script.get('page.export.sent') ?? '', deps.script, language));
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
    log('caller.email_set', {});
    return await page(typed, 'page.email.saved');
  }
  if (action === 'goals') {
    // Added to what the first call wrote down, never shown back: this page
    // opens for whoever has the link, and the list is theirs. SCRIPT.md §19.
    const line = (form.get('goals') ?? '').replace(/\s+/g, ' ').trim().slice(0, GOALS_MAX);
    if (before || !line) return await page();
    const added = await (deps.store as PostgresStore).addToGoals(phone, line);
    log('caller.goals_added', { outcome: added });
    return await page(undefined, undefined, { goalsNote: added === 'added' ? 'page.goals.saved' : 'page.goals.full' });
  }
  if (action === 'stop-cancel') return await page();
  if (action === 'forget-confirm') {
    await (deps.store as PostgresStore).forget(phone);
    log('caller.forgotten', {});
    return html(res, 200, forgottenPage(deps.script, language));
  }
  // Neither is on the page before the first call, and neither means anything
  // there: SKIP writes nothing, so the call would come anyway, and "later"
  // rings eight hours from now for a call that may be days away.
  if ((action === 'skip' || action === 'later') && before) return await page();

  const said = phraseFor(form);
  if (!said) return await page();
  // Straight through the same path a text would take, so the two ways of
  // moving a call cannot drift apart.
  const out = await handleReply(phone, said, slot, { ...deps, sms: silent }, new Date());
  // Stopping gets its own page because it is the one outcome that has to
  // carry the way back: somebody who stopped by texting STOP has a number the
  // carrier will not deliver to, so START cannot reach them and this link is
  // all they have left.
  if (out.action === 'stopped') return html(res, 200, stoppedPage(deps.script, language, via));
  if (out.action === 'started') return await page();
  return html(res, 200, donePage(out.said, deps.script, language));
}

/**
 * A copy of everything, to the address already on file.
 *
 * Never throws: privacy.md promises this works from the link in every text,
 * and a 500 on that promise is worse than the silence it replaces. A caller
 * with no address on file gets the same page — there is nowhere to send it,
 * and saying so would tell whoever is holding the phone whether an address
 * exists.
 */
async function emailEverything(deps: LoopDeps, phone: string, email: string | undefined): Promise<void> {
  try {
    if (!email) return;
    const letter = await composeExport(deps.store, phone, deps.script);
    if (!letter) return;
    await deps.mailer.send(email, letter);
    log('export.sent', {});
  } catch (e) {
    log('export.failed', { reason: (e as Error).message });
  }
}

/**
 * The one email about a failed card.
 *
 * Never throws. The billing state is already written, and a webhook that
 * returns 500 because an email bounced is a webhook Lemon Squeezy will resend
 * — which is how one failed payment becomes four identical letters.
 */
async function tellThemTheCardFailed(deps: LoopDeps, phoneHash: string): Promise<void> {
  try {
    const phone = await deps.store.phoneFor(phoneHash);
    if (!phone) return;
    const caller = await deps.store.load(phone);
    if (!caller.email) return;
    const letter = composePaymentFailed(deps.script, checkoutLink(phoneHash, caller.email));
    if (!letter) return;
    await deps.mailer.send(caller.email, letter);
    log('billing.told_them', {});
  } catch (e) {
    log('billing.notice_failed', { reason: (e as Error).message });
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
