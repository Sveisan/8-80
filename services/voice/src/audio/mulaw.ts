/**
 * PCMU (G.711 µ-law) is the default codec on the Telnyx leg and is also a
 * format the voice provider accepts, so call audio passes through untranscoded.
 * We decode only to measure energy for local turn detection — never in the
 * audio path.
 */
const TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  TABLE[i] = sign ? -sample : sample;
}

export function mulawToPcm16(buf: Uint8Array): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = TABLE[buf[i] as number] as number;
  return out;
}

/** RMS amplitude, 0..1. */
export function rms(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  const pcm = mulawToPcm16(buf);
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = (pcm[i] as number) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}
