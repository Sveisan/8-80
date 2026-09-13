import { log } from '../log.ts';
import type { Sms } from './types.ts';

/**
 * Texts through Twilio's REST API, over fetch.
 *
 * The `twilio` package is already a dependency of the telephony adapter, so
 * this is not about avoiding one. It is that SMS outlives the voice vendor:
 * whoever ends up running the calls, the missed-call text and the reschedule
 * reply stay ours. Keeping this path independent of the telephony adapter means
 * removing that adapter cannot take the texts with it.
 */
export class TwilioSms implements Sms {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
  ) {}

  async send(to: string, body: string): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: this.from, Body: body }),
    });

    if (!res.ok) {
      // The response echoes the number back. The status is all that is loggable.
      log('sms.send_failed', { status: res.status });
      throw new Error(`Twilio refused the message (HTTP ${res.status})`);
    }
    log('sms.sent', { via: 'twilio' });
  }
}
