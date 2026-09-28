import type { IncomingMessage } from 'node:http';
import { config } from '../config.ts';
import { TTL_MS as LINK_TTL_MS } from './token.ts';

/**
 * The browser that signed up, remembered for a week.
 *
 * Not an account and not a login: there is nothing to sign into and no way to
 * get one of these except by proving a number with a code sent to it, on the
 * sign-up form, a minute ago. It is a link the browser holds instead of the
 * messages app, and it gets exactly a link's terms:
 *
 * - Seven days, the life of the link in the welcome text minted beside it. The
 *   first call is always inside that week, and after it every text carries a
 *   fresh link, so nothing is gained by remembering longer and a laptop in a
 *   shared kitchen is exposed for longer.
 * - Stateful, a row in `links` like any other code, so deleting everything
 *   withdraws it and nothing needs rotating.
 * - It opens the same boring page, which shows the slot and nothing about the
 *   person. A partner who picks up the laptop finds a time and some buttons.
 * - Not the copy, and not the deletion. Those hand over or destroy everything,
 *   and a browser that once belonged to somebody is not proof enough for
 *   either; the page says they are behind the link in any text.
 *
 * HttpOnly, because no script on the page needs it. SameSite=Lax, so a form
 * on somebody else's site cannot post to the page with it; and a fetch-metadata
 * check on top, for the browsers that send it. Secure whenever the public
 * address is https.
 */
export const BROWSER = 'browser';
/** Opened within this long of signing up, the page says "done" before anything else. */
export const FRESH_MS = 10 * 60_000;

export function browserCookie(code: string): string {
  const secure = config.link.publicUrl().startsWith('https:') ? '; Secure' : '';
  return `${BROWSER}=${code}; Path=/; Max-Age=${Math.floor(LINK_TTL_MS / 1000)}; HttpOnly; SameSite=Lax${secure}`;
}

export const clearBrowser = (): string => `${BROWSER}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

export function cookieOf(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || undefined;
  }
  return undefined;
}

/** A post that another site started. Old browsers send nothing, and SameSite covers them. */
export const crossSite = (req: IncomingMessage): boolean => req.headers['sec-fetch-site'] === 'cross-site';
