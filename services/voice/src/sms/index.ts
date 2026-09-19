import { log } from '../log.ts';
import { FileSms } from './file.ts';
import { TwilioSms } from './twilio.ts';
import type { Sms } from './types.ts';

export type { Sms } from './types.ts';
export { FileSms } from './file.ts';
export { TwilioSms } from './twilio.ts';
export { parseReply, moveTo, type Reply } from './reply.ts';

/**
 * Twilio when it is configured, a file when it is not.
 *
 * All three variables or none — but a half-configured pair is reported rather
 * than thrown, for the same reason as the mailer: this runs inside `openDeps`,
 * which every tick calls, so throwing here meant a missing auth token stopped
 * the phone ringing. A missed-call text is what happens when a call goes wrong;
 * it must not be the thing that makes one go wrong.
 *
 * `preflight` and `doctor` fail on the half-configured case, where failing is
 * free. Nothing silently reports a text as sent that was not.
 */
export function openSms(): Sms {
  const sid = process.env['TWILIO_ACCOUNT_SID'];
  const token = process.env['TWILIO_AUTH_TOKEN'];
  const from = process.env['SMS_FROM_NUMBER'];
  if (sid && token && from) return new TwilioSms(sid, token, from);
  if (sid || token || from) {
    const missing = [
      sid ? '' : 'TWILIO_ACCOUNT_SID',
      token ? '' : 'TWILIO_AUTH_TOKEN',
      from ? '' : 'SMS_FROM_NUMBER',
    ].filter(Boolean);
    log('sms.misconfigured', { note: `${missing.join(', ')} missing — texts are written, not sent` });
    return new FileSms();
  }
  log('sms.sender', { kind: 'file', note: 'SMS_FROM_NUMBER is unset — texts are written, not sent' });
  return new FileSms();
}
