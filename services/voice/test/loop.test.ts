import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseScript } from '../src/script.ts';
import { endpointing } from '../src/config.ts';
import { runCall } from '../src/call/session.ts';
import { MockVoiceProvider } from '../src/adapters/voice/mock.ts';
import type { MediaBridge } from '../src/adapters/telephony/types.ts';

const script = parseScript(readFileSync(resolve(import.meta.dirname, '../../../SCRIPT.md'), 'utf8'));

/** In PCMU, 0x00 decodes to near full scale and 0xFF to silence. */
const LOUD = Buffer.alloc(160, 0x00);
const QUIET = Buffer.alloc(160, 0xff);

function fakeMedia() {
  let audio: ((c: Buffer) => void) | undefined;
  let hangup: (() => void) | undefined;
  const sent: Buffer[] = [];
  const bridge: MediaBridge = {
    onAudio: (cb) => {
      audio = cb;
    },
    onHangup: (cb) => {
      hangup = cb;
    },
    send: (c) => {
      sent.push(c);
    },
    close: () => {},
  };
  return {
    bridge,
    sent,
    push: (c: Buffer) => audio?.(c),
    end: () => hangup?.(),
  };
}

/** Drives the loop on a fake clock: 20ms per frame, no real waiting. */
async function drive(frames: { buf: Buffer; count: number }[], hard: boolean) {
  const media = fakeMedia();
  const voice = new MockVoiceProvider();
  let clock = 1_000_000;
  const done = runCall({
    script,
    profile: { callNumber: 2, lastCommitment: 'run three times', consecutiveUndone: hard ? 3 : 0 },
    media: media.bridge,
    voice,
    endpointingCfg: endpointing(0.25),
    now: () => clock,
  });
  await new Promise((r) => setImmediate(r));
  for (const f of frames) {
    for (let i = 0; i < f.count; i++) {
      clock += 20;
      media.push(f.buf);
    }
  }
  media.end();
  const metrics = await done;
  return { metrics, voice, media };
}

test('speech then a short gap does not end the turn', async () => {
  // 600ms of speech, then 800ms of silence — under the base budget.
  const { voice } = await drive(
    [
      { buf: LOUD, count: 30 },
      { buf: QUIET, count: 40 },
    ],
    false,
  );
  assert.equal(voice.responses, 0, 'the agent should still be waiting');
});

test('a five-second thinking pause is held, then the turn completes', async () => {
  const { metrics, voice } = await drive(
    [
      { buf: LOUD, count: 30 },
      { buf: QUIET, count: 300 }, // 6s
    ],
    false,
  );
  assert.equal(voice.responses, 1, 'the agent should take exactly one turn');
  const turn = metrics.turns[0];
  assert.ok(turn, 'a turn should have been recorded');
  assert.ok(turn.endpointLatencyMs >= 2000, `waited ${turn.endpointLatencyMs}ms`);
});

test('the caller hears the agent — audio is bridged back to telephony', async () => {
  const { media } = await drive(
    [
      { buf: LOUD, count: 30 },
      { buf: QUIET, count: 300 },
    ],
    false,
  );
  assert.ok(media.sent.length > 0, 'no audio reached the caller');
});

test('metrics record time-to-first-audio and cost stays null without configured rates', async () => {
  const { metrics } = await drive(
    [
      { buf: LOUD, count: 30 },
      { buf: QUIET, count: 300 },
    ],
    false,
  );
  const s = metrics.summary();
  assert.equal(typeof s['timeToFirstAudioMs'], 'number');
  assert.equal((s['cost'] as { total: number | null }).total, null, 'must not invent a cost');
});

test('the third-week-running question only appears when the pattern is there', async () => {
  const plain = await drive([{ buf: QUIET, count: 5 }], false);
  const repeated = await drive([{ buf: QUIET, count: 5 }], true);
  assert.ok(!/Third week running/i.test(plain.voice.instructions));
  assert.match(repeated.voice.instructions, /Third week running/i);
  assert.match(repeated.voice.instructions, /Do NOT conclude anything about why/i);
});

test('instructions are built from SCRIPT.md and carry the silence rule', async () => {
  const { voice } = await drive([{ buf: QUIET, count: 5 }], false);
  assert.match(voice.instructions, /The pause before the real answer is the entire product/);
  assert.match(voice.instructions, /Mm\./, 'the default nothing variant should be in the prompt');
  assert.ok(!voice.instructions.includes('!'), 'no exclamation marks reach the model');
});

test('the mentor speaks first — the caller is never answered by silence', async () => {
  // No caller audio at all: whatever else happens, the line must not stay empty.
  const { voice, media } = await drive([{ buf: QUIET, count: 5 }], false);
  assert.equal(voice.greetings, 1, 'the agent should open the call exactly once');
  assert.ok(media.sent.length > 0, 'the greeting never reached the caller');
});

test('no unfilled slot is ever left where the mentor could read it aloud', async () => {
  const { voice } = await drive([{ buf: QUIET, count: 5 }], false);
  const spoken = voice.instructions.split('\nSLOTS\n')[1]?.split('\n').slice(1).join('\n') ?? '';
  const left = [...spoken.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]);
  // The model fills these three from what was actually said; anything else is a bug.
  const allowed = new Set(['{{commitment}}', '{{day}}', '{{eight|eighty}}']);
  assert.deepEqual(left.filter((s) => !allowed.has(s)), [], 'unfilled slot in the instructions');
});
