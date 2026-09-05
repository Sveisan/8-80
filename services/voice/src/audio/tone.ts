import { pcm16ToMulaw } from './mulaw.ts';

/**
 * A short tone, in the same µ-law 8 kHz frames the call uses.
 *
 * It exists to answer one question that a silent call cannot: is the path from
 * this service back to the caller's ear working at all? If the beep is heard
 * and the mentor is not, the fault is in the voice provider's audio. If the
 * beep is not heard either, the fault is in telephony and nothing about the
 * model matters yet.
 */
export function toneFrames(durationMs: number, hz = 440, frameMs = 20): Buffer[] {
  const rate = 8000;
  const samples = Math.round((durationMs / 1000) * rate);
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    // Fade the ends so it reads as a soft beep rather than a click.
    const fade = Math.min(1, i / 400, (samples - i) / 400);
    pcm[i] = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000 * fade);
  }
  const mulaw = pcm16ToMulaw(pcm);
  const per = (rate / 1000) * frameMs;
  const frames: Buffer[] = [];
  for (let o = 0; o < mulaw.length; o += per) frames.push(mulaw.subarray(o, Math.min(o + per, mulaw.length)));
  return frames;
}
