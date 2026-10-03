import { log } from '../log.ts';
import { config } from '../config.ts';
import type { Mailer } from './mailer.ts';
import type { Recap } from './compose.ts';
import { letterHtml } from './letter.ts';
import { SendFailure, type Receipt, type SendOptions, type DeliveryStatus } from '../messages/types.ts';

/**
 * The recap, through Resend.
 *
 * Over fetch rather than their SDK: one POST with a JSON body is not worth a
 * dependency, and the dependency is the thing that has to be audited when it
 * is the package handling what somebody committed to.
 *
 * Both parts, always. The HTML is the letter on headed paper (BRAND.md §9) and
 * the text is the same words with nothing around them — sent together rather
 * than instead of each other, because a recap that only exists as HTML is a
 * recap some people cannot read, and one that only exists as text reads as
 * machine output, which is what the first one to go out did.
 */
export class ResendMailer implements Mailer {
  readonly retryWindowMs = 24 * 3600_000;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly endpoint = 'https://api.resend.com/emails',
    private readonly markUrl = config.recap.markUrl(),
  ) {}

  async send(to: string, recap: Recap, options?: SendOptions): Promise<Receipt> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(8000), redirect: 'error',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json', ...(options ? { 'Idempotency-Key': options.idempotencyKey } : {}) },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject: recap.subject,
        html: letterHtml(recap, { ...(this.markUrl ? { markUrl: this.markUrl } : {}), ...(recap.date ? { date: recap.date } : {}), ...(recap.action ? { action: recap.action } : {}) }),
        text: recap.body,
      }),
    });

    if (!res.ok) {
      // The body can carry the address back; the status and our own words are
      // all that belongs in a log.
      const detail = res.status === 422 ? 'rejected the address or the sender' : 'refused the send';
      log('recap.send_failed', { status: res.status, detail });
      throw new SendFailure(res.status === 429 || res.status >= 500 ? 'retry' : 'permanent', `Resend ${detail} (HTTP ${res.status})`);
    }

    log('recap.sent', { via: 'resend' });
    const receipt = await res.json() as { id?: string };
    if (!receipt.id) throw new SendFailure('retry', 'No email receipt');
    return { id: receipt.id };
  }

  async deliveryStatus(id: string): Promise<DeliveryStatus> {
    const response = await fetch(`${this.endpoint}/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new Error('Email receipt unavailable');
    const value = await response.json() as { last_event?: string };
    return ['delivered', 'opened', 'clicked'].includes(value.last_event ?? '') ? 'delivered' : ['bounced', 'failed', 'complained'].includes(value.last_event ?? '') ? 'failed' : 'pending';
  }
}
