/** One outbound text. Nothing here is ever the commitment — see SCRIPT.md §13. */
export interface Sms {
  send(to: string, body: string): Promise<void>;
}

/**
 * The carrier refused because this number has opted out.
 *
 * Its own type because it is the one send failure that is not a failure: it is
 * the person telling us something, arriving as an error from a third party
 * several hours after they said it. Everything else that throws from `send` is
 * a problem with us or the network; this is a decision we have to honour, and
 * the honouring is stopping the calls — see SCRIPT.md §13.
 */
export class OptedOut extends Error {
  constructor(readonly code: number) {
    super('the number has opted out of messages');
    this.name = 'OptedOut';
  }
}

/** Twilio's codes for "this number does not want messages from you". */
const OPT_OUT_CODES = new Set([21610]);

export const isOptOutCode = (code: unknown): boolean => typeof code === 'number' && OPT_OUT_CODES.has(code);
