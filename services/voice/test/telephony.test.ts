import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { twilioMediaBridge } from '../src/adapters/telephony/twilio.ts';
import { telnyxMediaBridge } from '../src/adapters/telephony/telnyx.ts';

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  send(s: string) {
    this.sent.push(s);
  }
  close() {}
}
const asWs = (f: FakeSocket) => f as unknown as WebSocket;
const frame = (o: unknown) => Buffer.from(JSON.stringify(o));

for (const [name, make, startFrame, sidKey] of [
  ['twilio', twilioMediaBridge, { event: 'start', streamSid: 'MZ123' }, 'streamSid'],
  ['telnyx', telnyxMediaBridge, { event: 'start', stream_id: 'st_123' }, 'stream_id'],
] as const) {
  test(`${name}: caller audio is decoded from base64 and handed to the loop`, () => {
    const ws = new FakeSocket();
    const bridge = make(asWs(ws));
    const heard: Buffer[] = [];
    bridge.onAudio((c) => heard.push(c));
    ws.emit('message', frame(startFrame));
    ws.emit('message', frame({ event: 'media', media: { payload: Buffer.from([0x00, 0xff]).toString('base64') } }));
    assert.equal(heard.length, 1);
    assert.deepEqual([...(heard[0] as Buffer)], [0x00, 0xff]);
  });

  test(`${name}: agent audio goes back with the stream id attached`, () => {
    const ws = new FakeSocket();
    const bridge = make(asWs(ws));
    ws.emit('message', frame(startFrame));
    bridge.send(Buffer.from([0x7f]));
    assert.equal(ws.sent.length, 1);
    const out = JSON.parse(ws.sent[0] as string) as Record<string, unknown>;
    assert.equal(out['event'], 'media');
    assert.equal(out[sidKey], (startFrame as Record<string, string>)[sidKey]);
  });

  test(`${name}: hangup fires on stop and on socket close`, () => {
    for (const how of ['stop', 'close'] as const) {
      const ws = new FakeSocket();
      const bridge = make(asWs(ws));
      let ended = false;
      bridge.onHangup(() => {
        ended = true;
      });
      ws.emit('message', frame(startFrame));
      if (how === 'stop') ws.emit('message', frame({ event: 'stop' }));
      else ws.emit('close');
      assert.ok(ended, `${name} did not end the call on ${how}`);
    }
  });

  test(`${name}: malformed frames are ignored rather than crashing the call`, () => {
    const ws = new FakeSocket();
    const bridge = make(asWs(ws));
    bridge.onAudio(() => assert.fail('should not have produced audio'));
    ws.emit('message', Buffer.from('not json'));
    ws.emit('message', frame({ event: 'media' }));
    ws.emit('message', frame({ event: 'unknown-future-event' }));
  });
}

test('twilio: audio produced before the start frame is held, not dropped', () => {
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  // The greeting can be ready before Twilio's start frame arrives. Dropping it
  // loses the opening words and is indistinguishable from a mute line.
  bridge.send(Buffer.from([0x11, 0x22]));
  assert.equal(ws.sent.length, 0, 'nothing can be sent before the stream id is known');
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  assert.equal(ws.sent.length, 1, 'the held audio should follow the start frame');
  const out = JSON.parse(ws.sent[0] as string) as { media: { payload: string } };
  assert.deepEqual([...Buffer.from(out.media.payload, 'base64')], [0x11, 0x22]);
});

test('twilio: outbound audio is split into the 20ms frames the carrier expects', () => {
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  bridge.send(Buffer.alloc(400, 0x7f));
  assert.equal(ws.sent.length, 3, '400 bytes is two full frames and a partial');
  const sizes = ws.sent.map((s) => Buffer.from((JSON.parse(s) as { media: { payload: string } }).media.payload, 'base64').length);
  assert.deepEqual(sizes, [160, 160, 80]);
});
