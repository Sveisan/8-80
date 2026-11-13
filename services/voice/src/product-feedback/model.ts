import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const FEEDBACK_COOKIE = 'product_feedback';
export const RETENTION_MS = 30 * 86400_000;
export const COMMENT_MAX = 4000;
export const IMAGE_MAX = 1_000_000;
export const JSON_MAX = 1_400_000;
export const STATES = ['queued', 'reviewing', 'needs_input', 'ready', 'released', 'closed'] as const;
export type FeedbackState = typeof STATES[number];
export interface FeedbackInput {
  comment: string;
  page: string;
  viewport: string;
  release: string;
  image?: { type: 'image/png' | 'image/jpeg' | 'image/webp'; data: string };
}

export const enabled = (): boolean => process.env['PRODUCT_FEEDBACK_ENABLED'] === '1' && Buffer.from(process.env['DATA_ENCRYPTION_KEY'] ?? '', 'base64').length === 32;
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const mac = (value: string): string => createHmac('sha256', process.env['DATA_ENCRYPTION_KEY'] ?? '').update(`product-feedback:${value}`).digest('hex');
export function equal(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function newSession(now = new Date()): string {
  const value = `${+now}.${randomBytes(32).toString('hex')}`;
  return `${value}.${mac(value)}`;
}
export function validSession(value: string | undefined, now = new Date()): value is string {
  if (!value || !/^\d{13}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)) return false;
  const [at, token, signature] = value.split('.');
  return +at! <= +now && +now - +at! < RETENTION_MS && equal(signature!, mac(`${at}.${token}`));
}
export const csrfFor = (session: string): string => mac(`csrf:${session}`);
/** Daily rotating bucket; neither an IP address nor a permanent browser fingerprint. */
export const clientBucket = (client: string, now = new Date()): string => mac(`limit:${now.toISOString().slice(0, 10)}:${client}`);

/** Never keep query strings, link credentials, route parameters, or arbitrary paths. */
export function safePage(value: unknown): string {
  if (typeof value !== 'string') return 'other';
  let path: string;
  try { path = new URL(value, 'https://feedback.invalid').pathname; } catch { return 'other'; }
  if (['/', '/start', '/me', '/access', '/memory', '/privacy', '/terms'].includes(path)) return path;
  if (path.startsWith('/start/')) return '/start';
  if (path.startsWith('/access/')) return '/access';
  if (path.startsWith('/r/')) return '/me';
  if (path.startsWith('/f/')) return '/f';
  if (path === '/beliefs' || path.startsWith('/beliefs/')) return '/beliefs';
  if (path === '/unblock' || path.startsWith('/unblock/')) return '/unblock';
  return 'other';
}
export function readInput(value: unknown, release = ''): FeedbackInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v['comment'] !== 'string') return undefined;
  const comment = v['comment'].trim();
  if (!comment || comment.length > COMMENT_MAX || comment.includes(String.fromCharCode(0))) return undefined;
  const viewport = typeof v['viewport'] === 'string' && /^\d{2,5}x\d{2,5}$/.test(v['viewport']) ? v['viewport'] : '';
  const input: FeedbackInput = { comment, page: safePage(v['page']), viewport, release: /^[a-f0-9]{7,40}$/.test(release) ? release : '' };
  if (v['image'] !== undefined) {
    const image = v['image'] as Record<string, unknown> | null;
    if (!image || typeof image['data'] !== 'string' || !['image/png', 'image/jpeg', 'image/webp'].includes(String(image['type']))) return undefined;
    if (image['data'].length > Math.ceil(IMAGE_MAX / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image['data'])) return undefined;
    const bytes = Buffer.from(image['data'], 'base64');
    if (!bytes.length || bytes.length > IMAGE_MAX || bytes.toString('base64') !== image['data']) return undefined;
    const type = image['type'] as NonNullable<FeedbackInput['image']>['type'];
    const matches = type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!matches) return undefined;
    input.image = { type, data: image['data'] };
  }
  return input;
}

/** GitHub receives a content-free ticket. Private report contents stay in the service. */
export function ticket(id: string): { title: string; body: string } {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid feedback reference');
  return { title: `Product feedback ${id.slice(0, 8)}`, body: `An 8&80 product feedback report is ready for private review.\n\n<!-- product-feedback:${id} -->\n\nThe original comment and optional screenshot are held privately by the feedback service for up to 30 days. They must not be copied into public issues, pull requests, code, test fixtures or logs.\n\nImplementation may be prepared automatically. Release requires manual approval.\n` };
}
