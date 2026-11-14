import { readFile, stat } from 'node:fs/promises';
import { parse } from 'dotenv';
import type { Turn } from '../call/outcome.ts';
import { weeklyQuality } from './weekly.ts';
import { reviewWithJev, type JevReviewInput } from './jev.ts';

const usage = 'Use quality:jev --file PATH [--send-to-jev [--key-file PATH]]. Default: local checks only. --send-to-jev sends the selected conversation, recap and optional trusted facts to TypeSafe for advisory review. No calls, messages or state changes are made.';
const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
async function boundedFile(path: string, maxBytes: number): Promise<string> {
  if ((await stat(path)).size > maxBytes) throw Error('File too large.');
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw Error('File too large.');
  return text;
}
function packet(value: unknown): JevReviewInput {
  const p = record(value);
  if (!p || !Array.isArray(p['conversation']) || !p['conversation'].length || p['conversation'].length > 1000
    || typeof p['candidateRecap'] !== 'string' || !p['candidateRecap'].trim()) throw Error('Invalid packet.');
  const conversation = p['conversation'].map((v: unknown): Turn => {
    const turn = record(v);
    if (!turn || !['agent', 'caller'].includes(String(turn['speaker'])) || typeof turn['text'] !== 'string') throw Error('Invalid turn.');
    return { speaker: turn['speaker'] as Turn['speaker'], text: turn['text'] };
  });
  const context = p['trustedContext'] === undefined ? {} : record(p['trustedContext']);
  if (!context || Object.keys(context).length > 50 || Object.values(context).some(v => typeof v !== 'string')) throw Error('Invalid trusted context.');
  return { conversation, candidateRecap: p['candidateRecap'], trustedContext: context as Record<string, string> };
}
async function keyFrom(path: string | undefined): Promise<string | undefined> {
  if (process.env['TYPESAFE_API_KEY']?.trim()) return process.env['TYPESAFE_API_KEY'];
  if (!path) return undefined;
  try { return parse(await boundedFile(path, 16_384))['TYPESAFE_API_KEY']; }
  catch { return undefined; }
}
try {
  const args = process.argv.slice(2);
  if (!args.length || args.length === 1 && args[0] === '--help') console.log(usage);
  else {
    const options = new Map<string, string>();
    let enabled = false;
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--send-to-jev') {
        if (enabled) throw Error('Duplicate flag.');
        enabled = true; continue;
      }
      const value = args[++i];
      if (!key || !['--file', '--key-file'].includes(key) || !value || value.startsWith('--') || options.has(key)) throw Error('Invalid arguments.');
      options.set(key, value);
    }
    if (!options.has('--file') || options.has('--key-file') && !enabled) throw Error('Invalid arguments.');
    const input = packet(JSON.parse(await boundedFile(options.get('--file')!, 128_000)) as unknown);
    const report = weeklyQuality({ providerCallId: 'local-review', durationMs: 0, turns: [...input.conversation] });
    const jev = await reviewWithJev(input, { enabled, ...(enabled ? { apiKey: await keyFrom(options.get('--key-file')) } : {}) });
    // Only allowlisted counts, verdicts and triage scores leave this process.
    console.log(JSON.stringify({ source: 'local_quality_packet', report, jev }, null, 2));
  }
} catch {
  console.error('The local review could not read its source or arguments. No source text, path or credentials were printed.');
  console.error(usage);
  process.exitCode = 1;
}
