import { mulawToPcm16 } from './mulaw.ts';

/**
 * A playable file from call audio, so a voice can be judged on a laptop
 * instead of costing a phone call. 8 kHz mono, the same band the caller hears
 * — auditioning at studio quality would flatter a voice the phone will not.
 */
export function mulawToWav(mulaw: Buffer, rate = 8000): Buffer {
  const pcm = mulawToPcm16(mulaw);
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(pcm[i] as number, i * 2);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
