import { config } from './config.ts';

/**
 * npm run models
 *
 * Asks xAI what it will accept. Answers two questions at once — whether the
 * API key works, and what the voice models are actually called — which is the
 * pair that has cost the most guessing.
 */
const key = config.xai.apiKey();
const base = config.xai.url.replace(/^wss:/, 'https:').replace(/\/realtime$/, '');

console.log(`\nAsking ${base}/models what exists…\n`);

const res = await fetch(`${base}/models`, {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(15_000),
});

if (res.status === 401) {
  console.log('  ✕ 401 — the API key is not accepted. XAI_API_KEY is wrong or revoked.\n');
  process.exit(1);
}
if (!res.ok) {
  console.log(`  ✕ ${res.status}\n      ${(await res.text()).slice(0, 500)}\n`);
  process.exit(1);
}

console.log('  · the API key works\n');

const body = (await res.json()) as { data?: { id?: string }[] };
const ids = (body.data ?? []).map((m) => m.id).filter((x): x is string => Boolean(x));

if (!ids.length) {
  console.log('  No model list returned. Raw response:\n');
  console.log(JSON.stringify(body, null, 2).slice(0, 1000));
  process.exit(0);
}

const voice = ids.filter((id) => /voice|realtime|speech/i.test(id));
console.log(`  Voice-ish models (${voice.length}):`);
for (const id of voice) console.log(`    ${id}${id === config.xai.model ? '   ← currently set' : ''}`);
console.log(`\n  All models (${ids.length}): ${ids.join(', ')}\n`);

if (!ids.includes(config.xai.model)) {
  console.log(`  ✕ XAI_VOICE_MODEL is "${config.xai.model}", which is not in that list.`);
  console.log('    Set it to one of the voice models above.\n');
} else {
  console.log(`  · XAI_VOICE_MODEL "${config.xai.model}" is in the list\n`);
}
