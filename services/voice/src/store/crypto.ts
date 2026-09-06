import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Application-layer encryption for what a caller said.
 *
 * Before the database, not by it: disk encryption does not protect against a
 * compromised application or an over-broad query, which are the realistic
 * failures. AES-256-GCM, so a tampered record fails to decrypt rather than
 * decrypting to something else.
 *
 * The key here is a single service key, which is the honest version of what we
 * have today. The design calls for a per-user data key wrapped by a master key
 * in a secret manager; that is a key-management change behind this same
 * interface, and it is recorded as owed in DECISIONS.md.
 */
const ALGO = 'aes-256-gcm';

export class MissingKeyError extends Error {
  constructor() {
    super(
      'DATA_ENCRYPTION_KEY is not set, so there is nowhere safe to put what the caller said. ' +
        'Generate one with: openssl rand -base64 32',
    );
  }
}

function key(): Buffer {
  const raw = process.env['DATA_ENCRYPTION_KEY'];
  if (!raw) throw new MissingKeyError();
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded. Generate: openssl rand -base64 32');
  return buf;
}

export function hasKey(): boolean {
  return Boolean(process.env['DATA_ENCRYPTION_KEY']);
}

/** Returns iv.tag.ciphertext, base64, in one string. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

export function decrypt(packed: string): string {
  const [iv, tag, body] = packed.split('.');
  if (!iv || !tag || !body) throw new Error('Encrypted value is malformed');
  const d = createDecipheriv(ALGO, key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
}
