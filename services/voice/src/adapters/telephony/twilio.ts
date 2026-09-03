import twilio from 'twilio';
import type { WebSocket } from 'ws';
import { log } from '../../log.ts';
import type { CallHandle, MediaBridge, PlaceCallOptions, TelephonyProvider } from './types.ts';

/**
 * Twilio, the documented fallback — and the fastest route to a first call,
 * because the TwiML goes inline with the dial request. Twilio never has to
 * fetch anything from us, so only the media websocket needs to be reachable.
 *
 * Media is mu-law 8 kHz, the same as the Telnyx leg and an accepted voice
 * provider format, so audio still passes through untranscoded.
 *
 * Params taken from the official twilio npm SDK types (v6.1.0). The media frame
 * shape is listed in docs/VERIFY.md — confirm before a call to anyone else.
 */
/** Minimal shape we use, so the dial parameters can be tested without a network. */
export interface TwilioLike {
  calls: {
    create(params: Record<string, unknown>): Promise<{ sid: string }>;
    (sid: string): { update(params: Record<string, unknown>): Promise<unknown> };
  };
}

export class TwilioProvider implements TelephonyProvider {
  readonly name = 'twilio';
  private client: TwilioLike;

  constructor(client?: TwilioLike) {
    if (client) {
      this.client = client;
      return;
    }
    const sid = process.env['TWILIO_ACCOUNT_SID'];
    const token = process.env['TWILIO_AUTH_TOKEN'];
    if (!sid || !token) throw new Error('Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN. See .env.example.');
    this.client = twilio(sid, token) as unknown as TwilioLike;
  }

  async placeCall(opts: PlaceCallOptions): Promise<CallHandle> {
    const vr = new twilio.twiml.VoiceResponse();
    // Connect (not Start) is the bidirectional form — we need to speak back.
    vr.connect().stream({ url: opts.streamUrl, track: 'inbound_track' });

    const call = await this.client.calls.create({
      to: opts.to,
      from: opts.from,
      timeout: opts.ringSeconds,
      twiml: vr.toString(),

      // Answering machine detection, for the rule that we never leave a
      // voicemail.
      //
      // asyncAmd MUST be 'true'. Without it Twilio blocks execution of the
      // TwiML until detection completes — the stream never starts, the caller
      // answers to silence, and nothing reaches our media socket. It looks
      // exactly like a broken tunnel, which is how it cost an evening.
      machineDetection: 'Enable',
      asyncAmd: 'true',
      // Acting on the result needs asyncAmdStatusCallback, which needs a
      // public HTTP endpoint. Wired at Milestone 3, with the hang-up.
    });

    log('call.dialled', { provider: 'twilio', sid: call.sid ? 'set' : 'missing' });
    return {
      id: call.sid,
      hangup: async () => {
        await this.client.calls(call.sid).update({ status: 'completed' });
      },
    };
  }
}

/**
 * Twilio Media Streams frames: connected, start, media, stop, mark.
 * Outbound audio needs the streamSid from the start frame.
 */
export function twilioMediaBridge(ws: WebSocket): MediaBridge {
  let audioCb: ((c: Buffer) => void) | undefined;
  let hangupCb: (() => void) | undefined;
  let streamSid: string | undefined;

  ws.on('message', (raw) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (String(ev['event'] ?? '')) {
      case 'start':
        streamSid = String((ev['streamSid'] as string) ?? '');
        log('media.start', { provider: 'twilio' });
        break;
      case 'media': {
        const payload = (ev['media'] as { payload?: string } | undefined)?.payload;
        if (payload && audioCb) audioCb(Buffer.from(payload, 'base64'));
        break;
      }
      case 'stop':
        log('media.stop', { provider: 'twilio' });
        hangupCb?.();
        break;
      default:
        break;
    }
  });
  ws.on('close', () => hangupCb?.());

  return {
    onAudio: (cb) => {
      audioCb = cb;
    },
    onHangup: (cb) => {
      hangupCb = cb;
    },
    send: (chunk) => {
      if (ws.readyState !== 1 || !streamSid) return;
      ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload: chunk.toString('base64') } }));
    },
    close: () => ws.close(),
  };
}
