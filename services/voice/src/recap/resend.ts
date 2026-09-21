import { log } from '../log.ts';
import type { Mailer } from './mailer.ts';
import type { Recap } from './compose.ts';
import { letterHtml } from './letter.ts';

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
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly endpoint = 'https://api.resend.com/emails',
    private readonly markUrl = process.env['RECAP_MARK_URL'],
  ) {}

  async send(to: string, recap: Recap): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject: recap.subject,
        html: letterHtml(recap, this.markUrl ? { markUrl: this.markUrl } : {}),
        text: recap.body,
      }),
    });

    if (!res.ok) {
      // The body can carry the address back; the status and our own words are
      // all that belongs in a log.
      const detail = res.status === 422 ? 'rejected the address or the sender' : 'refused the send';
      log('recap.send_failed', { status: res.status, detail });
      throw new Error(`Resend ${detail} (HTTP ${res.status})`);
    }

    log('recap.sent', { via: 'resend' });
  }
}
