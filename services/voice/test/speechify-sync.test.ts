import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechifySettingsApi, syncAgents, parseState, mergeVariables, mergeAgentIds, restoreAgents, type SyncState, type Backup, type Variable } from '../src/agent/speechify-sync.ts';
import { promptPack, type PromptSpec } from '../src/agent/prompt-pack.ts';

const spec: PromptSpec = { role: 'return', name: 'Weekly', prompt: 'New {{call_number}}', variables: ['call_number'] };
const state = (): SyncState => ({ version: 1, ids: {} });
const now = new Date('2026-10-11T12:00:00Z');
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) result[key] = mergePatch((result[key] && typeof result[key] === 'object' && !Array.isArray(result[key]) ? result[key] : {}) as Record<string, unknown>, value as Record<string, unknown>);
    else result[key] = value;
  }
  return result;
}
function provider() {
  const agents: Record<string, Record<string, unknown>> = { agent_return: { id: 'agent_return', prompt: 'Old', tts: { voice_id: 'voice_original', speed: 0.8 }, first_message: 'Existing greeting', language: 'en', memory: { enabled: true }, tools: [{ name: 'end_call', kind: 'builtin', config: { builtin: 'end_call' } }] } };
  const variables: Record<string, Variable[]> = { agent_return: [{ key: 'custom', type: 'number', default: 7, description: 'Existing default' }] };
  const requests: { method: string; path: string; body?: Record<string, unknown>; key: string | null }[] = [];
  let ignorePrompt = false; let creationUncertain = false;
  const idsByKey = new Map<string, string>();
  const fetcher: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; const method = init?.method ?? 'GET'; const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ method, path, body, key: headers.get('Idempotency-Key') });
    assert.equal(new URL(String(url)).origin, 'https://api.speechify.ai'); assert.equal(init?.redirect, 'error');
    if (method === 'POST') {
      const key = headers.get('Idempotency-Key')!; let id = idsByKey.get(key);
      if (!id) { id = 'agent_created_' + idsByKey.size; idsByKey.set(key, id); agents[id] = { ...body, id }; variables[id] = []; }
      if (creationUncertain) { creationUncertain = false; throw new Error('Uncertain network error containing secret-fake-api-key'); }
      return Response.json({ id });
    }
    const parts = path.split('/'); const id = parts[3]!;
    if (!agents[id]) return Response.json({ error: 'not found' }, { status: 404 });
    if (parts[4] === 'variables') {
      if (method === 'PUT') {
        variables[id] = structuredClone(body!['variables']) as Variable[];
        return new Response(null, { status: 204 });
      }
      // Provider-only response metadata must never be sent back by PUT.
      return Response.json({ variables: variables[id]!.map(v => ({ ...v, created_at: 'provider-metadata' })) });
    }
    if (method === 'PATCH') {
      const patch = { ...body }; if (ignorePrompt) delete patch['prompt'];
      agents[id] = mergePatch(agents[id]!, patch);
    }
    return Response.json(agents[id]);
  };
  return { api: new SpeechifySettingsApi('secret-fake-api-key', fetcher), agents, variables, requests, idsByKey, ignorePrompt: () => { ignorePrompt = true; }, uncertain: () => { creationUncertain = true; } };
}
function options(overrides = {}) { return { specs: [spec], env: { SPEECHIFY_AGENT_ID: 'agent_return' }, state: state(), apply: true, now, saveState: async () => {}, saveBackup: async () => {}, ...overrides }; }

test('source pack uses dynamic values and isolates Beliefs from weekly caller memory', () => {
  const pack = promptPack('all'); assert.equal(pack.length, 5);
  assert.ok(pack[0]!.prompt.includes('{{first_name}}')); assert.ok(pack[1]!.prompt.includes('{{call_number}}'));
  for (const item of pack.slice(2)) { assert.ok(item.prompt.includes('{{belief_context}}')); assert.ok(!item.variables.includes('own_eight')); assert.deepEqual(item.variables, ['belief_context', 'call_kind', 'session_id', 'session_token']); }
});
test('read-only check makes no provider writes, backups or state saves', async () => {
  const p = provider(); let saves = 0;
  const reports = await syncAgents(p.api, options({ apply: false, saveBackup: async () => { saves++; }, saveState: async () => { saves++; } }));
  assert.ok(reports[0]!.changed); assert.equal(saves, 0); assert.ok(p.requests.every(r => r.method === 'GET'));
});
test('sync preserves voice, greeting, tools and defaults, adds variables before prompt, and skips unchanged writes', async () => {
  const p = provider(); let backup: Backup | undefined;
  const original = structuredClone(p.agents['agent_return']);
  const opts = options({ saveBackup: async (b: Backup) => { backup = b; } });
  await syncAgents(p.api, opts);
  assert.deepEqual(p.agents['agent_return'], { ...original, prompt: spec.prompt });
  assert.equal(p.variables['agent_return']![0]!.default, 7); assert.equal(p.variables['agent_return']!.length, 2);
  assert.ok(p.requests.findIndex(r => r.method === 'PUT') < p.requests.findIndex(r => r.method === 'PATCH'));
  assert.equal(p.requests.find(r => r.method === 'PUT')!.body!['variables'] && JSON.stringify(p.requests.find(r => r.method === 'PUT')!.body).includes('created_at'), false);
  assert.equal(backup!.agents[0]!.variables.length, 1);
  const before = p.requests.length; await syncAgents(p.api, opts);
  assert.ok(p.requests.slice(before).every(r => r.method === 'GET'));
});
test('all role IDs and variable limits are checked before the first provider write', async () => {
  const p = provider();
  await assert.rejects(syncAgents(p.api, options({ specs: [spec, { ...spec, role: 'first' }], env: { SPEECHIFY_AGENT_ID: 'agent_return', SPEECHIFY_FIRST_CALL_AGENT_ID: 'agent_return' } })), /same agent/);
  assert.equal(p.requests.length, 0);
  p.variables['agent_return'] = Array.from({ length: 20 }, (_, i) => ({ key: 'custom_' + i, type: 'string' }));
  await assert.rejects(syncAgents(p.api, options()), /20-variable/); assert.ok(p.requests.every(r => r.method === 'GET'));
});
test('backup failure stops before changing a live configuration', async () => {
  const p = provider(); await assert.rejects(syncAgents(p.api, options({ saveBackup: async () => { throw new Error('disk unavailable'); } })), /disk unavailable/);
  assert.ok(p.requests.every(r => r.method === 'GET'));
});
test('provider settings must be read back, never inferred from a successful PATCH', async () => {
  const p = provider(); p.ignorePrompt();
  await assert.rejects(syncAgents(p.api, options()), /did not retain/);
});
test('an uncertain create is never replayed; a supplied private agent ID recovers without a duplicate', async () => {
  const p = provider(); p.uncertain(); const saved = state(); const states: SyncState[] = [];
  const opts = options({ specs: [{ ...spec, role: 'first' as const }], state: saved, env: { SPEECHIFY_AGENT_ID: 'agent_return', SPEECHIFY_WEBHOOK_SECRET: 'fake-signing-secret', PUBLIC_URL: 'https://example.com' }, saveState: async (s: SyncState) => { states.push(structuredClone(s)); } });
  await assert.rejects(syncAgents(p.api, opts), /not confirmed/); assert.ok(saved.pending); assert.equal(p.idsByKey.size, 1);
  await assert.rejects(syncAgents(p.api, opts), /no second create/);
  const reports = await syncAgents(p.api, { ...opts, env: { ...opts.env, SPEECHIFY_FIRST_CALL_AGENT_ID: 'agent_created_0' } }); assert.equal(p.idsByKey.size, 1); assert.equal(reports[0]!.id, saved.ids.first); assert.equal(saved.pending, undefined);
  const creates = p.requests.filter(r => r.method === 'POST'); assert.equal(creates.length, 1);
  assert.equal(creates[0]!.body!['is_public'], false); assert.ok(!String(creates[0]!.body!['prompt']).includes('{{call_number}}'));
  assert.ok(states[0]!.pending); assert.equal(p.agents[reports[0]!.id]!['prompt'], spec.prompt);
});
test('changed setup, elapsed time or an incorrect recovery ID cannot replay an uncertain create', async () => {
  const p = provider(); p.uncertain(); const saved = state();
  const opts = options({ specs: [{ ...spec, role: 'first' as const }], state: saved, env: { SPEECHIFY_SETUP_VOICE_ID: 'voice_one', SPEECHIFY_WEBHOOK_SECRET: 'fake-signing-secret', PUBLIC_URL: 'https://example.com' } });
  await assert.rejects(syncAgents(p.api, opts));
  await assert.rejects(syncAgents(p.api, { ...opts, env: { ...opts.env, SPEECHIFY_SETUP_VOICE_ID: 'voice_two' } }), /unconfirmed/);
  await assert.rejects(syncAgents(p.api, { ...opts, now: new Date(+now + 24 * 3600_000) }), /unconfirmed/);
  await assert.rejects(syncAgents(p.api, { ...opts, env: { ...opts.env, SPEECHIFY_FIRST_CALL_AGENT_ID: 'agent_return' } }), /recovery ID/);
  assert.equal(p.requests.filter(r => r.method === 'POST').length, 1);
});
test('a confirmed creation saves its ID before configuration so a failed upload can resume without another POST', async () => {
  const p = provider(); p.ignorePrompt(); const saved = state();
  const opts = options({ specs: [{ ...spec, role: 'first' as const }], state: saved, env: { SPEECHIFY_SETUP_VOICE_ID: 'voice_one', SPEECHIFY_WEBHOOK_SECRET: 'fake-signing-secret', PUBLIC_URL: 'https://example.com' } });
  await assert.rejects(syncAgents(p.api, opts), /did not retain/); assert.ok(saved.ids.first); assert.equal(saved.pending, undefined);
  await assert.rejects(syncAgents(p.api, opts), /did not retain/);
  assert.equal(p.requests.filter(r => r.method === 'POST').length, 1);
});
test('Beliefs settings disable provider memory and voicemail content without changing any launch flag', async () => {
  const p = provider(); const env = { BELIEFS_DAILY_AGENT_ID: 'agent_return', PUBLIC_URL: 'https://example.com', BELIEFS_LIVE_CALLS: 'false' };
  await syncAgents(p.api, options({ specs: [{ ...spec, role: 'belief-daily' }], env }));
  assert.equal((p.agents['agent_return']!['memory'] as { enabled: boolean }).enabled, false);
  assert.equal(((p.agents['agent_return']!['amd'] as { on_voicemail: { action: string } }).on_voicemail.action), 'hangup');
  assert.equal(env.BELIEFS_LIVE_CALLS, 'false');
});
test('rollback restores the old prompt and variable catalog in a valid order', async () => {
  const p = provider(); let backup: Backup | undefined; const old = structuredClone(p.agents['agent_return']);
  await syncAgents(p.api, options({ saveBackup: async (b: Backup) => { backup = b; } }));
  assert.equal(await restoreAgents(p.api, backup), 1); assert.deepEqual(p.agents['agent_return'], old); assert.equal(p.variables['agent_return']!.length, 1);
});
test('Beliefs rollback removes introduced settings and nested keys rather than leaving them behind', async () => {
  const p = provider(); let backup: Backup | undefined;
  p.agents['agent_return']!['amd'] = { enabled: false, tuning: { timeout_seconds: 6 } };
  const old = structuredClone(p.agents['agent_return']);
  await syncAgents(p.api, options({ specs: [{ ...spec, role: 'belief-daily' }], env: { BELIEFS_DAILY_AGENT_ID: 'agent_return', PUBLIC_URL: 'https://example.com' }, saveBackup: async (b: Backup) => { backup = b; } }));
  assert.equal(await restoreAgents(p.api, backup), 1); assert.deepEqual(p.agents['agent_return'], old);
});
test('settings diagnostics cannot echo credentials or provider bodies, and unsupported hosts/paths cannot receive the key', async () => {
  const p = new SpeechifySettingsApi('secret-fake-api-key', async () => new Response('secret-fake-api-key fake-signing-secret personal prompt', { status: 422 }));
  await assert.rejects(p.request('PATCH', '/v1/agents/agent_one', { prompt: 'private text' }), e => e instanceof Error && e.message.includes('HTTP 422') && !/secret-fake|private text|personal prompt/.test(e.message));
  await assert.rejects(p.request('GET', '//attacker.example/v1/agents'), /Unsupported/);
  const network = new SpeechifySettingsApi('secret-fake-api-key', async () => { throw new Error('secret-fake-api-key'); });
  await assert.rejects(network.agent('agent_one'), e => e instanceof Error && !e.message.includes('secret-fake'));
});
test('saved routing changes are limited to agent IDs and preserve credentials and launch flags byte-for-byte', () => {
  const source = 'SPEECHIFY_API_KEY="private value"\nBELIEFS_LIVE_CALLS=false\nSPEECHIFY_AGENT_ID=old\nSPEECHIFY_AGENT_ID=duplicate\n';
  const result = mergeAgentIds(source, { return: 'agent_new', 'belief-daily': 'agent_daily' });
  assert.ok(result.includes('SPEECHIFY_API_KEY="private value"\nBELIEFS_LIVE_CALLS=false\n'));
  assert.equal(result.match(/SPEECHIFY_AGENT_ID=/g)!.length, 1); assert.ok(result.includes('BELIEFS_DAILY_AGENT_ID=agent_daily'));
  assert.throws(() => mergeAgentIds(source, { return: 'bad\nSPEECHIFY_API_KEY=leak' }));
  assert.throws(() => parseState({ version: 1, ids: { unknown: 'agent_one' } }));
  assert.equal(mergeVariables([{ key: 'call_number', type: 'number', default: 1 }], ['call_number'])[0]!.default, 1);
});
