import type { IncomingMessage } from 'node:http';
import type { LoopDeps } from '../loop/deps.ts';
import type { Answer } from '../signup/routes.ts';
import { BROWSER, clearBrowser, cookieOf, crossSite } from '../link/cookie.ts';
import { Links } from '../link/token.ts';
import { FILTERS, recentReviews, type Filter } from './dashboard.ts';
import { qualityPage, qualityGate } from './page.ts';
import { workerConfig } from './worker.ts';

export const qualityOwner = (): string | undefined => {
  const owner = process.env['CALL_QUALITY_OWNER_PHONE_HASH'];
  return owner && /^[0-9a-f]{64}$/.test(owner) ? owner : undefined;
};
const headers = {
  'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow, noarchive', 'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};
export async function qualityRoutes(req: IncomingMessage, url: URL, deps: LoopDeps, now = new Date()): Promise<Answer | undefined> {
  if (url.pathname !== '/call-quality' && url.pathname !== '/call-quality/signout') return undefined;
  const answer = (status: number, body: string, extra = {}): Answer => ({ status, body, headers: { ...headers, ...extra } });
  const owner = qualityOwner();
  if (!owner) return answer(404, qualityGate('unavailable'));
  if (req.method !== 'GET' && !(req.method === 'POST' && url.pathname === '/call-quality/signout')) return answer(405, qualityGate('unavailable'), { allow: 'GET' });
  const code = cookieOf(req, BROWSER);
  if (!code) return answer(401, qualityGate('signin'));
  let opened;
  try { opened = await new Links(deps.store.raw).open(code, now, 'browser'); }
  catch { return answer(503, qualityGate('error')); }
  if (!opened.ok) return answer(401, qualityGate('signin'));
  if (opened.claims.phoneHash !== owner) return answer(403, qualityGate('forbidden'));
  if (url.pathname === '/call-quality/signout') {
    if (req.method !== 'POST') return answer(405, qualityGate('unavailable'), { allow: 'POST' });
    if (crossSite(req)) return answer(403, qualityGate('forbidden'));
    await deps.store.raw`delete from links where code = ${code} and purpose = 'browser'`;
    return answer(303, '', { location: '/call-quality', 'set-cookie': clearBrowser() });
  }
  const filter = FILTERS.includes(url.searchParams.get('filter') as Filter) ? url.searchParams.get('filter') as Filter : 'all';
  const page = Math.min(10, Math.max(1, Number(url.searchParams.get('page')) || 1));
  try {
    const settings = workerConfig();
    return answer(200, qualityPage(await recentReviews(deps.store.raw, now, settings.startedAt), filter, Math.floor(page), now,
      settings.enabled && !!settings.apiKey?.trim() && !!settings.startedAt));
  } catch { return answer(503, qualityGate('error')); }
}
