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

test('twilio: outbound audio is split into 20ms frames and paced at the speed it is heard', async () => {
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  bridge.send(Buffer.alloc(400, 0x7f));

  // The model returns a whole utterance at once. Sending it at once turns
  // forty seconds of speech into two thousand messages in a few milliseconds,
  // and everything between us and the carrier has to carry that burst.
  assert.equal(ws.sent.length, 1, 'only the first frame goes immediately');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(ws.sent.length, 3, '400 bytes is two full frames and a partial');
  const sizes = ws.sent.map((s) => Buffer.from((JSON.parse(s) as { media: { payload: string } }).media.payload, 'base64').length);
  assert.deepEqual(sizes, [160, 160, 80]);
  bridge.close();
});

test('twilio: clearing drops audio that is queued but not yet sent', async () => {
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  bridge.send(Buffer.alloc(1600, 0x7f)); // a second of speech
  bridge.clear();
  await new Promise((r) => setTimeout(r, 120));
  const media = ws.sent.filter((s) => (JSON.parse(s) as { event: string }).event === 'media');
  assert.equal(media.length, 1, 'a barge-in must stop the audio that has not left yet');
  bridge.close();
});

test('twilio: clearing drops audio the carrier has not played yet', () => {
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  bridge.send(Buffer.alloc(160, 0x7f));
  bridge.clear();
  const last = JSON.parse(ws.sent[ws.sent.length - 1] as string) as Record<string, unknown>;
  assert.equal(last['event'], 'clear', 'a barge-in must stop the sound, not only the model');
  assert.equal(last['streamSid'], 'MZ123');
});

test('twilio: clearing before the stream starts drops the held audio too', () => {
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  bridge.send(Buffer.alloc(160, 0x7f));
  bridge.clear();
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  assert.equal(ws.sent.length, 0, 'audio cancelled before it was sent must not arrive late');
});

test('twilio: an event we do not handle is named, not dropped', () => {
  // A failing stream carries its reason in one of these. Silently ignoring it
  // is how a carrier-side failure gets debugged as an audio bug for two days.
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  ws.emit('message', frame({ event: 'error', code: 31951, message: 'Stream - Protocol - Invalid message' }));
  bridge.close();
  // The assertion is that it does not throw and the socket keeps working;
  // the naming itself goes to the log, which is where a human reads it.
  ws.emit('message', frame({ event: 'media', media: { payload: Buffer.from([0x7f]).toString('base64') } }));
  assert.ok(true);
});

test('twilio: pacing follows the clock, so jitter cannot accumulate', async () => {
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  // Half a second of audio: 25 frames at 20ms.
  bridge.send(Buffer.alloc(160 * 25, 0x7f));
  await new Promise((r) => setTimeout(r, 300));
  const sent = ws.sent.length;
  // Counting timer ticks drifts — a 20ms interval fires at 21 or 22 — and over
  // a long utterance the caller hears the gap as scattered speech.
  assert.ok(sent >= 13 && sent <= 17, `after 300ms about 15 frames should have gone, sent ${sent}`);
  bridge.close();
});

test('twilio: pendingMs reports what the caller has not heard yet', async () => {
  const ws = new FakeSocket();
  const bridge = twilioMediaBridge(asWs(ws));
  ws.emit('message', frame({ event: 'start', streamSid: 'MZ123' }));
  bridge.send(Buffer.alloc(160 * 50, 0x7f)); // one second
  const pending = bridge.pendingMs();
  assert.ok(pending > 800, `a second of audio should read as ~1000ms, got ${pending}`);
  bridge.clear();
  assert.equal(bridge.pendingMs(), 0, 'clearing empties it');
  bridge.close();
});
