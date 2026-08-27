import Telnyx from 'telnyx';
import type { WebSocket } from 'ws';
import { config } from '../../config.ts';
import { log } from '../../log.ts';
import type { CallHandle, MediaBridge, PlaceCallOptions, TelephonyProvider } from './types.ts';

/**
 * Telnyx Call Control.
 *
 * Dial params and streaming enums taken from the official telnyx npm SDK's
 * type definitions (v7.17.0), not from memory. Media arrives on our own
 * websocket as JSON frames carrying base64 RTP payload.
 *
 * PCMU end to end: PCMU is the Telnyx default and a format the voice provider
 * accepts, so audio passes through without transcoding in either direction.
 *
 * VERIFY BEFORE FIRST LIVE CALL — see docs/VERIFY.md.
 */
export class TelnyxProvider implements TelephonyProvider {
  readonly name = 'telnyx';
  private client = new Telnyx({ apiKey: config.telnyx.apiKey() });

  async placeCall(opts: PlaceCallOptions): Promise<CallHandle> {
    const res = await this.client.calls.dial({
      connection_id: config.telnyx.connectionId(),
      to: opts.to,
      from: opts.from,
      timeout_secs: opts.ringSeconds,
      // Never leave a voicemail: an AI voice on voicemail is uncanny and burns
      // synthesis for nothing. Detection lets the call loop hang up instead.
      answering_machine_detection: 'detect',
      stream_url: opts.streamUrl,
      stream_track: 'inbound_track',
      stream_bidirectional_mode: 'rtp',
      stream_bidirectional_codec: 'PCMU',
    });

    const id = (res as { data?: { call_control_id?: string } }).data?.call_control_id ?? '';
    log('call.dialled', { provider: 'telnyx', callControlId: id ? 'set' : 'missing' });

    return {
      id,
      hangup: async () => {
        await this.client.calls.actions.hangup(id, {});
      },
    };
  }
}

/**
 * Wraps the raw media websocket. Frame types observed on the Telnyx media
 * stream: connected, start, media, stop, error, mark, dtmf.
 */
export function telnyxMediaBridge(ws: WebSocket): MediaBridge {
  let audioCb: ((c: Buffer) => void) | undefined;
  let hangupCb: (() => void) | undefined;
  let streamId: string | undefined;

  ws.on('message', (raw) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (String(ev['event'] ?? '')) {
      case 'start':
        streamId = String((ev['stream_id'] as string) ?? '');
        log('media.start', {});
        break;
      case 'media': {
        const payload = (ev['media'] as { payload?: string } | undefined)?.payload;
        if (payload && audioCb) audioCb(Buffer.from(payload, 'base64'));
        break;
      }
      case 'stop':
        log('media.stop', {});
        hangupCb?.();
        break;
      case 'error':
        log('media.error', { detail: ev['payload'] });
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
      if (ws.readyState !== 1) return;
      ws.send(JSON.stringify({ event: 'media', stream_id: streamId, media: { payload: chunk.toString('base64') } }));
    },
    close: () => ws.close(),
  };
}
