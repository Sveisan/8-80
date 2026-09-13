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
 * All three variables or none. A half-configured sender that silently writes to
 * a file would mean nobody gets the one text this product sends, while the logs
 * report it went out.
 */
export function openSms(): Sms {
  const sid = process.env['TWILIO_ACCOUNT_SID'];
  const token = process.env['TWILIO_AUTH_TOKEN'];
  const from = process.env['SMS_FROM_NUMBER'];
  if (sid && token && from) return new TwilioSms(sid, token, from);
  if (sid || token || from) {
    throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and SMS_FROM_NUMBER go together.');
  }
  log('sms.sender', { kind: 'file', note: 'SMS_FROM_NUMBER is unset — texts are written, not sent' });
  return new FileSms();
}
