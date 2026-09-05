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

const BIAS = 0x84;
const CLIP = 32635;

/** PCM16 → µ-law, the standard G.711 encoder. */
export function pcm16ToMulaw(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let s = pcm[i] as number;
    const sign = s < 0 ? 0x80 : 0;
    if (s < 0) s = -s;
    if (s > CLIP) s = CLIP;
    s += BIAS;
    let exponent = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
    const mantissa = (s >> (exponent + 3)) & 0x0f;
    out[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return out;
}

/**
 * Rate conversion by averaging whole input windows. Adequate for telephony
 * band, and only used when a provider ignores the format we asked for — the
 * configured path is passthrough, with no conversion at all.
 */
export function resample(pcm: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const out = new Int16Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(pcm.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += pcm[j] as number;
    out[i] = end > start ? (sum / (end - start)) | 0 : 0;
  }
  return out;
}

/** Little-endian PCM16 bytes → samples. Odd trailing byte is the caller's to carry. */
export function bytesToPcm16(buf: Buffer): Int16Array {
  const n = buf.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}
