import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncWeeklyFlows, privateFlowTargets, SpeechifyFlowApi, type FlowApi, type FlowState } from '../src/agent/weekly-flow-sync.ts';
import { bindWeeklyFlow, weeklyFlow } from '../src/agent/weekly-flow.ts';
import { CONSOLE_VARIABLES } from '../src/prompt.ts';

const env = {
  WEEKLY_DIALOGUE_PILOT: '1', WEEKLY_DIALOGUE_READY: '0',
  SPEECHIFY_DIALOGUE_FIRST_CALL_AGENT_ID: 'agent_private_first', SPEECHIFY_DIALOGUE_AGENT_ID: 'agent_private_return',
  SPEECHIFY_DIALOGUE_FEMALE_FIRST_CALL_AGENT_ID: 'agent_private_female_first', SPEECHIFY_DIALOGUE_FEMALE_AGENT_ID: 'agent_private_female_return',
  SPEECHIFY_FIRST_CALL_AGENT_ID: 'agent_live_first', SPEECHIFY_AGENT_ID: 'agent_live_return',
};
const tools = [
  { id: 'builtin_silent', name: 'skip_turn', kind: 'builtin', enabled: true, config: { builtin: 'skip_turn' } },
  { id: 'tool_weekly', name: 'weekly_assist', kind: 'webhook', enabled: true },
  { id: 'builtin_hangup', name: 'end_call', kind: 'builtin', enabled: true, config: { builtin: 'end_call' } },
];
function setup() {
  const flows = new Map<string, { active?: unknown; draft?: unknown }>();
  const events: string[] = [], state: FlowState = { version: 1 };
  const api: FlowApi = { async request(method, path, body) {
    const id = path.split('/')[3]!, current = flows.get(id) ?? {};
    events.push(method + ' ' + path);
    if (path.endsWith('/tools')) return { tools, has_more: false };
    if (path.endsWith('/variables')) return { variables: CONSOLE_VARIABLES.map(key => ({ key })) };
    if (path.endsWith('/flow/publish')) {
      flows.set(id, { active: current.draft }); return { published: true };
    }
    if (path.endsWith('/flow/deactivate')) { flows.set(id, {}); return null; }
    if (path.endsWith('/flow')) {
      if (method === 'PUT') { flows.set(id, { ...current, draft: body }); return body; }
      return current;
    }
    return { is_public: false, memory: { enabled: false }, save_audio_recording: false };
  } };
  const options = {
    env, mode: 'stage' as const, ownerPilot: true, state,
    saveState: async () => { events.push('state'); }, backup: async () => { events.push('backup'); },
    assertIdle: async () => { events.push('idle'); },
  };
  return { api, options, state, events, flows };
}

test('tool filters bind verified IDs and cannot accidentally expose end_call', () => {
  const source = weeklyFlow('first'), bound = bindWeeklyFlow(source, tools);
  assert.deepEqual(source.nodes.find(n => n.type === 'subagent')?.config?.tools_filter, ['skip_turn', 'weekly_assist']);
  for (const n of bound.nodes.filter(n => n.type === 'subagent')) assert.deepEqual(n.config?.tools_filter, ['builtin_silent', 'tool_weekly']);
  for (const invalid of [tools.slice(1), [...tools, tools[0]], tools.map(t => t.name === 'skip_turn' ? { ...t, enabled: false } : t), tools.map(t => t.name === 'weekly_assist' ? { ...t, kind: 'client' } : t)]) {
    assert.throws(() => bindWeeklyFlow(source, invalid));
  }
});
test('staging validates all four before writing and never publishes, calls or sends', async () => {
  const s = setup(), r = await syncWeeklyFlows(s.api, s.options);
  assert.equal(r.roles.length, 4); assert.ok(r.roles.every(r => r.draftMatches && r.inactive));
  assert.equal(r.voiceApproved, false); assert.equal(r.callsStarted, 0); assert.equal(r.messagesSent, 0);
  assert.equal(s.events.filter(e => e.startsWith('PUT ')).length, 4);
  assert.ok(!s.events.some(e => e.startsWith('POST ')));
  assert.ok(s.events.indexOf('GET /v1/agents/agent_private_female_return/flow') < s.events.indexOf('backup'));
  assert.ok(s.events.indexOf('backup') < s.events.findIndex(e => e.startsWith('PUT ')));
});
test('activation reads back every active graph and a repeated activation does not publish twice', async () => {
  const s = setup();
  const first = await syncWeeklyFlows(s.api, { ...s.options, mode: 'activate' });
  assert.ok(first.roles.every(r => r.activeMatches)); assert.equal(s.state.pending, undefined);
  assert.equal(s.events.filter(e => e.endsWith('/publish')).length, 4);
  await syncWeeklyFlows(s.api, { ...s.options, mode: 'activate' });
  assert.equal(s.events.filter(e => e.endsWith('/publish')).length, 4);
  const rollback = await syncWeeklyFlows(s.api, { ...s.options, mode: 'deactivate' });
  assert.ok(rollback.roles.every(r => r.inactive));
});
test('live IDs, global activation, an active call and an unrelated draft are refused before mutation', async () => {
  assert.throws(() => privateFlowTargets({ ...env, SPEECHIFY_DIALOGUE_AGENT_ID: env.SPEECHIFY_AGENT_ID }));
  assert.throws(() => privateFlowTargets({ ...env, SPEECHIFY_DIALOGUE_AGENT_ID: env.SPEECHIFY_DIALOGUE_FIRST_CALL_AGENT_ID }));
  for (const patch of [{ ownerPilot: false }, { env: { ...env, WEEKLY_DIALOGUE_READY: '1' } }, { assertIdle: async () => { throw Error('busy'); } }]) {
    const s = setup(); await assert.rejects(syncWeeklyFlows(s.api, { ...s.options, ...patch }));
    assert.ok(!s.events.some(e => /^(PUT|POST) /.test(e)));
  }
  const s = setup();
  s.flows.set('agent_private_female_return', { draft: { nodes: [{ key: 'custom', type: 'end' }], edges: [] } });
  await assert.rejects(syncWeeklyFlows(s.api, s.options), /unrelated flow/);
  assert.ok(!s.events.some(e => /^(PUT|POST) /.test(e)));
});
test('an uncertain publish is journaled and never blindly replayed', async () => {
  const s = setup(), original = s.api.request.bind(s.api);
  s.api.request = async (method, path, body) => {
    if (path.endsWith('/publish')) throw Error('network failure');
    return original(method, path, body);
  };
  await assert.rejects(syncWeeklyFlows(s.api, { ...s.options, mode: 'activate' }));
  assert.deepEqual(s.state.pending, { role: 'first', action: 'activate' });
  s.api.request = original; const before = s.events.length;
  await assert.rejects(syncWeeklyFlows(s.api, { ...s.options, mode: 'activate' }), /unconfirmed/);
  assert.ok(!s.events.slice(before).some(e => /^(PUT|POST) /.test(e)));
  const pending = s.flows.get('agent_private_first')!;
  s.flows.set('agent_private_first', { active: pending.draft });
  await syncWeeklyFlows(s.api, { ...s.options, mode: 'activate' });
  assert.equal(s.events.filter(e => e === 'POST /v1/agents/agent_private_first/flow/publish').length, 0);
});
test('the API refuses calls and arbitrary writes and never exposes provider error bodies', async () => {
  const calls: string[] = [];
  const api = new SpeechifyFlowApi('synthetic-key', async (url, init) => {
    calls.push(String(url)); assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
    return new Response('secret private provider text', { status: 400 });
  });
  await assert.rejects(api.request('POST', '/v1/agents/outbound-calls'), /Unsupported/);
  await assert.rejects(api.request('PUT', '/v1/agents/agent_private/tools', {}), /Unsupported/);
  await assert.rejects(api.request('GET', '/v1/agents/agent_private/flow'), /^Error: Weekly flow request refused \(HTTP 400\); response withheld\.$/);
  assert.equal(calls.length, 1);
});
