import type { WebSocket } from 'ws';
import { config } from '../../config.ts';
import { TelnyxProvider, telnyxMediaBridge } from './telnyx.ts';
import { TwilioProvider, twilioMediaBridge } from './twilio.ts';
import type { MediaBridge, TelephonyProvider } from './types.ts';

/**
 * Only the selected provider is constructed, so a missing key for the other one
 * is never an error. TELEPHONY_PROVIDER picks; nothing above here knows which.
 */
export function telephonyProvider(): TelephonyProvider {
  return config.telephonyProvider === 'twilio' ? new TwilioProvider() : new TelnyxProvider();
}

export function mediaBridge(ws: WebSocket): MediaBridge {
  return config.telephonyProvider === 'twilio' ? twilioMediaBridge(ws) : telnyxMediaBridge(ws);
}
