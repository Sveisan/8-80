import { log } from '../log.ts';
import type { Mailer } from './mailer.ts';
import type { Recap } from './compose.ts';

/**
 * The recap, through Resend.
 *
 * Over fetch rather than their SDK: one POST with a JSON body is not worth a
 * dependency, and the dependency is the thing that has to be audited when it
 * is the package handling what somebody committed to.
 *
 * Plain text, no HTML part. The email is four short lines whose only job is to
 * be findable on a Thursday, and an HTML wrapper would make it look like
 * marketing — which is the one thing it must not look like, because the whole
 * point is that it reads as the same voice that rang them.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly endpoint = 'https://api.resend.com/emails',
  ) {}

  async send(to: string, recap: Recap): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [to], subject: recap.subject, text: recap.body }),
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
