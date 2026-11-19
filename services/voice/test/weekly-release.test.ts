import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyWeeklyRelease } from '../src/weekly/release.ts';
import { bindWeeklyFlow, weeklyFlow, weeklyFlowRoles, type WeeklyFlow } from '../src/agent/weekly-flow.ts';
import { dialogueAgentKeys } from '../src/weekly/dialogue-policy.ts';
import { CONSOLE_VARIABLES } from '../src/prompt.ts';
import type { FlowApi } from '../src/agent/weekly-flow-sync.ts';

function fixture() {
  const env: NodeJS.ProcessEnv = { SPEECHIFY_SEND_VARIABLES: '1', WEEKLY_DIALOGUE_READY: '1', WEEKLY_TOOLS_READY: '0' };
  const tools = [
    { id: 'builtin_silent', name: 'skip_turn', kind: 'builtin', enabled: true, config: { builtin: 'skip_turn' } },
    { id: 'tool_weekly', name: 'weekly_assist', kind: 'webhook', enabled: true },
    { id: 'builtin_end', name: 'end_call', kind: 'builtin', enabled: true, config: { builtin: 'end_call' } },
  ];
  const agents = new Map<string, Record<string, unknown>>(), heads = new Map<string, { active: WeeklyFlow; draft: WeeklyFlow | null }>();
  for (const role of weeklyFlowRoles) {
    const id = 'agent_' + role.replaceAll('-', '_'); env[dialogueAgentKeys[role]] = id;
    agents.set(id, { id, prompt: 'Unchanged legacy fallback prompt', first_message: 'Unchanged legacy greeting', is_public: false,
      memory: { enabled: false }, save_audio_recording: false, amd: { enabled: true, on_voicemail: { action: 'hangup' } }, tts: { voice_id: role }, updated_at: 'metadata' });
    heads.set(id, { active: bindWeeklyFlow(weeklyFlow(role), tools), draft: null });
  }
  const requests: string[] = [];
  let paginateTools = false, paginateVariables = false;
  const vars = CONSOLE_VARIABLES.map(key => ({ key, type: 'string' }));
  const api: FlowApi = { async request(method, path) {
    requests.push(method + ' ' + path); assert.equal(method, 'GET');
    const id = path.split('/')[3]!;
    if (path.endsWith('/tools')) return { tools, has_more: paginateTools };
    if (path.endsWith('/variables')) return { variables: vars, has_more: paginateVariables };
    if (path.endsWith('/flow')) return heads.get(id);
    return agents.get(id);
  } };
  return { env, api, tools, agents, heads, requests, vars, paginate: (kind: string) => { paginateTools = kind === 'tools'; paginateVariables = kind === 'variables'; } };
}

test('release verification accepts all four current published flows without rewriting their legacy fallbacks or flags', async () => {
  const f = fixture(), before = structuredClone({ env: f.env, agents: [...f.agents], heads: [...f.heads], tools: f.tools });
  const result = await verifyWeeklyRelease(f.api, f.env);
  assert.equal(result.verified, true); assert.equal(result.roles.length, 4); assert.equal(result.providerWrites, 0);
  assert.match(result.providerFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual({ env: f.env, agents: [...f.agents], heads: [...f.heads], tools: f.tools }, before);
  assert.equal(f.requests.length, 16); assert.ok(f.requests.every(v => v.startsWith('GET ')));
});
for (const change of ['prompt', 'greeting', 'tool-filter', 'missing-active', 'unreviewed-draft']) test(`release refuses ${change} drift without a provider write`, async () => {
  const f = fixture(), entry = f.heads.values().next().value!;
  if (change === 'missing-active') entry.active = { nodes: [], edges: [] };
  else {
    const graph = change === 'unreviewed-draft' ? structuredClone(entry.active) : entry.active;
    if (change === 'prompt' || change === 'unreviewed-draft') graph.nodes.find(n => n.type === 'subagent')!.config!['system_prompt_override'] += '\nUnreviewed change';
    if (change === 'greeting') graph.nodes.find(n => n.type === 'say')!.config!['text'] = 'Unreviewed greeting';
    if (change === 'tool-filter') graph.nodes.find(n => n.type === 'subagent')!.config!['tools_filter'] = ['builtin_end'];
    if (change === 'unreviewed-draft') entry.draft = graph;
  }
  await assert.rejects(() => verifyWeeklyRelease(f.api, f.env));
  assert.equal(f.env['WEEKLY_DIALOGUE_READY'], '1'); assert.ok(f.requests.every(v => v.startsWith('GET ')));
});
test('matching drafts and reordered API catalogues preserve the release fingerprint; setting drift is visible', async () => {
  const f = fixture(); for (const h of f.heads.values()) h.draft = structuredClone(h.active);
  const first = await verifyWeeklyRelease(f.api, f.env);
  f.tools.reverse(); f.vars.reverse();
  for (const a of f.agents.values()) a['updated_at'] = 'new metadata';
  assert.equal((await verifyWeeklyRelease(f.api, f.env)).providerFingerprint, first.providerFingerprint);
  f.agents.values().next().value!['tts'] = { voice_id: 'changed' };
  assert.notEqual((await verifyWeeklyRelease(f.api, f.env)).providerFingerprint, first.providerFingerprint);
});
for (const kind of ['tools', 'variables']) test(`release refuses an incomplete ${kind} catalogue`, async () => {
  const f = fixture(); f.paginate(kind); await assert.rejects(() => verifyWeeklyRelease(f.api, f.env), /Incomplete/);
});
test('privacy, voicemail, duplicate variables, missing required variables and missing server-variable injection fail closed', async () => {
  for (const change of ['public', 'memory', 'recording', 'voicemail', 'variable', 'duplicate', 'injection']) {
    const f = fixture(), first = f.agents.values().next().value!;
    if (change === 'public') first['is_public'] = true;
    if (change === 'memory') first['memory'] = { enabled: true };
    if (change === 'recording') first['save_audio_recording'] = true;
    if (change === 'voicemail') first['amd'] = { enabled: true, on_voicemail: { action: 'message' } };
    if (change === 'variable') f.vars.pop();
    if (change === 'duplicate') f.vars.push(f.vars[0]!);
    if (change === 'injection') f.env['SPEECHIFY_SEND_VARIABLES'] = '0';
    await assert.rejects(() => verifyWeeklyRelease(f.api, f.env));
  }
});
test('inactive-dialogue release check needs no provider credential and does not activate anything', () => {
  const script = fileURLToPath(new URL('../src/weekly/release-cli.ts', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', script, '--if-enabled'], {
    encoding: 'utf8', env: { ...process.env, WEEKLY_DIALOGUE_READY: '0', WEEKLY_DIALOGUE_PILOT: '0', SPEECHIFY_API_KEY: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { required: false, configurationChanged: false, providerWrites: 0 });
});
