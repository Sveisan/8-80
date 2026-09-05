import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToPcm16, mulawToPcm16, pcm16ToMulaw, resample, rms } from '../src/audio/mulaw.ts';
import { toneFrames } from '../src/audio/tone.ts';
import { mulawToWav } from '../src/audio/wav.ts';

test('mu-law survives a round trip within its own quantisation', () => {
  const pcm = Int16Array.from([0, 100, -100, 5000, -5000, 20000, -20000, 32000]);
  const back = mulawToPcm16(pcm16ToMulaw(pcm));
  for (let i = 0; i < pcm.length; i++) {
    const a = pcm[i] as number;
    const b = back[i] as number;
    // G.711 is lossy by design: logarithmic, so error scales with amplitude.
    assert.ok(Math.abs(a - b) <= Math.max(8, Math.abs(a) * 0.06), `${a} came back as ${b}`);
  }
});

test('resampling 24 kHz down to 8 kHz keeps the signal, not just the length', () => {
  const src = new Int16Array(2400);
  for (let i = 0; i < src.length; i++) src[i] = Math.round(Math.sin((2 * Math.PI * 300 * i) / 24000) * 10000);
  const out = resample(src, 24000, 8000);
  assert.equal(out.length, 800);
  const energy = rms(pcm16ToMulaw(out));
  assert.ok(energy > 0.05, `a 300Hz tone should survive the downsample, got ${energy}`);
});

test('an odd PCM16 byte count never shifts the sample boundary', () => {
  const buf = Buffer.from([0x10, 0x27, 0x00]); // 10000, then a stray byte
  const pcm = bytesToPcm16(buf);
  assert.equal(pcm.length, 1);
  assert.equal(pcm[0], 10000);
});

test('the test tone is exactly as long as asked, in carrier-sized frames', () => {
  const frames = toneFrames(600);
  assert.equal(frames.reduce((n, f) => n + f.length, 0), 4800, '600ms at 8kHz is 4800 bytes');
  assert.ok(frames.every((f) => f.length <= 160));
  assert.ok(rms(frames[10] as Buffer) > 0.05, 'the tone must be audible, not silence');
});

test('the wav header describes exactly the audio that follows', () => {
  const mulaw = toneFrames(100).reduce((a, b) => Buffer.concat([a, b]));
  const wav = mulawToWav(mulaw);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), 8000, 'telephone bandwidth, like the call');
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), mulaw.length * 2, 'data size must match the samples');
  assert.equal(wav.length, 44 + mulaw.length * 2);
});
