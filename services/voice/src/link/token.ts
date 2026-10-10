import { randomInt } from 'node:crypto';
import postgres from 'postgres';

/** A week, so the code outlives the missed call it was sent about. */
export const TTL_MS = 7 * 24 * 3600_000;

/** No 0/O and no 1/l: somebody may read this off one screen and type it into another. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 10;
/**
 * A browser's code is never read off a screen or typed, so it has no reason to
 * be short, and about 125 bits means the cookie is not the weak end of anything.
 */
const BROWSER_LENGTH = 25;

/**
 * What a code opens.
 *
 * `reschedule` is the link in a text: the whole page, export and delete
 * included. `browser` is the cookie set on the browser that just signed up:
 * the same page without those two, because a browser remembering somebody is
 * weaker proof than a message that arrived on their phone. A code of one kind
 * never opens the other, so a cookie cannot be pasted into a link to get more.
 */
export type Purpose = 'reschedule' | 'browser' | 'feedback' | 'memory' | 'beliefs';

/**
 * A feedback link lasts a fortnight: it is not about this week's call, and
 * somebody who means to answer "when I have a minute" should find it working.
 */
const TTL: Record<Purpose, number> = { reschedule: TTL_MS, browser: TTL_MS, feedback: 14 * 24 * 3600_000, memory: 15 * 60_000, beliefs: 3600_000 };

export interface LinkClaims {
  phoneHash: string;
  purpose: Purpose;
  /** When the code was minted, so the page can tell a minute-old sign-up from a revisit. */
  issuedAt: Date;
}

export type Opened = { ok: true; claims: LinkClaims } | { ok: false; why: string };

/**
 * Short codes for the reschedule page.
 *
 * Ten random characters — about fifty bits, which is far past guessing over
 * HTTP for a code that expires in a week and can only move a phone call. The
 * shortness is the feature: a text message carrying eighty characters of
 * base64 looks like precisely the link nobody should tap, and this product's
 * whole problem is being trusted enough to be answered.
 *
 * Stateful rather than signed, because a row can be deleted. A signed token
 * cannot be withdrawn without rotating the secret for everybody at once.
 */
export class Links {
  constructor(private readonly sql: postgres.Sql | postgres.TransactionSql) {}

  async mint(phoneHash: string, now = new Date(), purpose: Purpose = 'reschedule'): Promise<string> {
    // ISO strings rather than Date objects: the driver serialises a Date
    // correctly in most positions and threw here, and a timestamp that is
    // already text cannot be misread by anything downstream.
    const expiresAt = new Date(now.getTime() + TTL[purpose]).toISOString();
    // Collisions are vanishingly unlikely and not impossible; retrying twice
    // is cheaper than the incident where two people share a link.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = randomCode((purpose === 'browser' || purpose === 'memory' || purpose === 'beliefs') ? BROWSER_LENGTH : LENGTH);
      const inserted = await this.sql<{ code: string }[]>`
        insert into links (code, phone_hash, purpose, created_at, expires_at)
        values (${code}, ${phoneHash}, ${purpose}, ${now.toISOString()}, ${expiresAt})
        on conflict (code) do nothing
        returning code
      `;
      if (inserted[0]) return code;
    }
    throw new Error('could not mint a link code');
  }

  async open(code: string, now = new Date(), purpose: Purpose = 'reschedule'): Promise<Opened> {
    if (!/^[a-z2-9]{4,32}$/.test(code)) return { ok: false, why: 'malformed' };

    const rows = await this.sql<{ phone_hash: string; purpose: string; created_at: Date }[]>`
      update links set last_used_at = now()
      where code = ${code} and expires_at > ${now.toISOString()}
      returning phone_hash, purpose, created_at
    `;
    const row = rows[0];
    if (!row) return { ok: false, why: 'unknown or expired' };
    if (row.purpose !== purpose) return { ok: false, why: 'wrong purpose' };
    return { ok: true, claims: { phoneHash: row.phone_hash, purpose, issuedAt: new Date(row.created_at) } };
  }

  /** Housekeeping. An expired code is refused either way; this stops the table growing. */
  async prune(now = new Date()): Promise<number> {
    const gone = await this.sql<{ code: string }[]>`delete from links where expires_at < ${now.toISOString()} returning code`;
    return gone.length;
  }
}

function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
