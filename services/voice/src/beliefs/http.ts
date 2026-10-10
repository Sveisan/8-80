import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from '../config.ts';

export const csrfFor = (token: string): string => createHash('sha256').update(`beliefs:csrf:${token}`).digest('hex');
export function practiceCookie(token: string, preview = false): string {
  const secure = !preview && config.link.publicUrl().startsWith('https://') ? '; Secure' : '';
  return `beliefs=${token}; Path=/beliefs; Max-Age=${token ? 3600 : 0}; HttpOnly; SameSite=Lax${secure}`;
}
export async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 24_000) throw new Error('request_too_large');
    chunks.push(Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}
export const pageHeaders = {
  'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'referrer-policy':'no-referrer',
  'x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://buy.stripe.com https://checkout.stripe.com https://*.lemonsqueezy.com; base-uri 'none'; frame-ancestors 'none'",
};
