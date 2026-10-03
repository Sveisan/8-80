import type { IncomingMessage } from 'node:http';
import { config } from '../config.ts';
import { TTL_MS as LINK_TTL_MS } from './token.ts';

/**
 * A week-long, purpose-scoped credential for a browser verified at signup or
 * through recovery. It opens scheduling and a masked delivery address, without
 * exposing private context. Export and deletion require a fresh phone proof
 * or a reschedule link. Deletion withdraws the stateful credential.
 *
 * HttpOnly, SameSite=Lax and Secure on the public HTTPS address. Mutations also
 * check Fetch Metadata and Origin. Recovery can issue new access after expiry;
 * the credential itself is never made permanent.
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
export const crossSite = (req: IncomingMessage): boolean => {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  // Our no-referrer policy makes a navigation POST's Origin null. Fetch
  // Metadata is browser-controlled, so only a same-origin form may use this
  // exception; sandboxed documents and other sites remain refused.
  if (origin === 'null') return req.headers['sec-fetch-site'] !== 'same-origin';
  try {
    const supplied = new URL(origin);
    const publicUrl = config.link.publicUrl();
    return publicUrl ? supplied.origin !== new URL(publicUrl).origin : supplied.host !== req.headers.host;
  } catch {
    return true;
  }
};

/** Separate, short-lived authority to read and correct private context. */
export function memoryCookie(code: string): string {
  return `memory=${code}; Path=/memory; Max-Age=900; HttpOnly; SameSite=Strict${config.link.publicUrl().startsWith('https:') ? '; Secure' : ''}`;
}
export const clearMemory = (): string => 'memory=; Path=/memory; Max-Age=0; HttpOnly; SameSite=Strict';
