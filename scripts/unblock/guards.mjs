/** Boundaries for the opt-in, loopback-only Unblock sandbox. Never used by production routing. */
import { URL } from 'node:url';

export function checkSandbox({ databaseUrl, publicUrl, stripeKey = '', checkout = '' }) {
  const db = new URL(databaseUrl), site = new URL(publicUrl);
  if (db.hostname !== '127.0.0.1' || db.port !== '55586' || db.pathname !== '/unblock_sandbox' || db.protocol !== 'postgres:' || db.username !== 'postgres' || db.password || db.search || db.hash) throw Error('Sandbox requires its own local unblock_sandbox database.');
  if (site.protocol !== 'https:' || site.hostname !== '127.0.0.1' || site.port !== '8793' || site.pathname !== '/' || site.username || site.password || site.search || site.hash) throw Error('Sandbox must bind to an HTTPS loopback origin.');
  if (stripeKey && !/^(sk|rk|rkcs)_test_[A-Za-z0-9]+$/.test(stripeKey)) throw Error('Only Stripe test credentials may enter this sandbox.');
  if (checkout) {
    const link = new URL(checkout);
    if (link.protocol !== 'https:' || link.hostname !== 'buy.stripe.com' || !link.pathname.startsWith('/test_') || link.username || link.password || link.port) throw Error('Only a Stripe test payment link is allowed.');
  }
  return { databaseUrl, publicUrl: site.origin, stripeKey, checkout };
}

export const syntheticPhone = phone => /^\+47923009\d{2}$/.test(phone);
