import type { IncomingMessage } from 'node:http';
import type { LoopDeps } from '../loop/deps.ts';
import type { Answer } from '../signup/routes.ts';
import { smsConfigured } from '../config.ts';
import { enqueue, dispatchMessage } from '../messages/outbox.ts';
import { readPhone } from '../signup/form.ts';
import { Limiter } from '../signup/limit.ts';
import { phoneKey } from '../store/postgres.ts';
import { browserCookie, memoryCookie, crossSite } from '../link/cookie.ts';
import { Links } from '../link/token.ts';
import { AccessCodes } from './codes.ts';
import { accessPage, accessCodePage } from './page.ts';

const sendLimit = new Limiter(10, 3600_000);
const verifyLimit = new Limiter(30, 10 * 60_000);

export async function accessRoutes(req: IncomingMessage, url: URL, deps: LoopDeps, client: string, now = new Date()): Promise<Answer | undefined> {
  if (url.pathname !== '/access' && url.pathname !== '/access/verify') return undefined;
  const { script } = deps;
  let memory = url.searchParams.get('for') === 'memory';
  const page = (status: number, note?: string, phone = ''): Answer => ({ status, body: accessPage(script, phone, note, memory) });
  if (req.method === 'GET') return page(200);
  if (req.method !== 'POST') return page(405);
  if (crossSite(req)) return page(403, 'access.tryagain');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2048) return page(413, 'access.tryagain');
    chunks.push(chunk as Buffer);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  memory = form.get('intent') === 'memory';
  const phone = readPhone(form.get('phone') ?? '');
  if (!phone) return page(400, 'signup.error.number');
  const codes = new AccessCodes(deps.store.raw);
  const id = (form.get('id') ?? '').slice(0, 36);
  const limited = (): Answer => /^[0-9a-f-]{36}$/.test(id)
    ? { status: 429, body: accessCodePage(script, id, phone, 'access.limited', memory) }
    : page(429, 'access.limited', phone);
  if (url.pathname === '/access/verify') {
    if (!verifyLimit.take(client, now.getTime())) return limited();
    const hash = await codes.verify(id, form.get('code') ?? '', now);
    // A challenge proves the number it was issued for, never a hidden field.
    const access = hash ? await deps.store.raw.begin(async (tx) => {
      // Pair with forget's caller lock: deleting an account must also withdraw
      // credentials being created at the same time.
      const [caller] = await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
      if (!caller) return undefined;
      const links = new Links(tx);
      return { browser: await links.mint(hash, now, 'browser'), link: await links.mint(hash, now), memory: memory ? await links.mint(hash, now, 'memory') : undefined };
    }) : undefined;
    if (!access) {
      return { status: 400, body: accessCodePage(script, id, phone, 'access.code.wrong', memory) };
    }
    // Fresh phone proof grants the same controls as a new SMS link.
    return { status: 303, body: '', headers: { location: access.memory ? '/memory' : `/r/${access.link}`, 'set-cookie': access.memory ? [browserCookie(access.browser), memoryCookie(access.memory)] : browserCookie(access.browser) } };
  }
  if (!sendLimit.take(client, now.getTime())) return limited();
  if (!smsConfigured()) return page(503, 'access.unavailable', phone);
  const hash = phoneKey(phone);
  // Unknown numbers receive the same page and limits, but are never enrolled or texted.
  let messageId: string | undefined;
  const challenge = await codes.start(hash, now, async (tx, id, code) => {
    const [caller] = await tx`select phone_hash from callers where phone_hash = ${hash} for update`;
    if (caller) messageId = await enqueue(tx, { eventKey: `access:${id}`, phoneHash: hash, channel: 'sms', kind: 'access', reference: id,
      to: phone, body: (script.get('access.sms') ?? '').replace('{{code}}', code), expiresAt: new Date(+now + 10 * 60_000) }, now);
  });
  if (!challenge) return limited();
  if (messageId) {
    const result = await dispatchMessage(deps, messageId, now);
    if (result !== 'accepted') {
      if (result === 'failed' || result === 'suppressed') await codes.invalidate(challenge.id);
      return { status: 503, body: accessCodePage(script, challenge.id, phone, result === 'failed' || result === 'suppressed' ? 'access.unavailable' : 'access.delivery.pending', memory) };
    }
  }
  return { status: 200, body: accessCodePage(script, challenge.id, phone, undefined, memory) };
}
