import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNBLOCK_TOOL_PARAMS, ToolSetupError, provisionUnblockTools, resolveAgentIds, verifyToolDefinition, unblockToolUrl, type Binding, type ToolIo } from '../src/unblock/tools-core.ts';

const PUBLIC = 'https://8and80.example';
const URL_OK = `${PUBLIC}/unblock/tool`;
const goodDefinition = () => ({ id: 'tool_cu', name: 'capture_unblock', kind: 'webhook', config: { url: URL_OK, method: 'POST', params: UNBLOCK_TOOL_PARAMS.map(p => ({ ...p })) } });

test('the pinned parameter contract is exact', () => {
  assert.deepEqual(UNBLOCK_TOOL_PARAMS.filter(p => p.required).map(p => p.name), ['session_id', 'session_token', 'event_id', 'caller_text']);
  assert.deepEqual(UNBLOCK_TOOL_PARAMS.filter(p => p.type !== 'string').map(p => `${p.name}:${p.type}`), ['confirmed:boolean', 'week:integer']);
  assert.equal(UNBLOCK_TOOL_PARAMS.length, 15);
});

test('definition verification accepts the exact contract in any parameter order', () => {
  verifyToolDefinition(goodDefinition(), PUBLIC);
  const reversed = goodDefinition(); reversed.config.params.reverse();
  verifyToolDefinition(reversed, PUBLIC);
});

test('definition verification rejects every deviation', () => {
  const mutate = (fn: (d: ReturnType<typeof goodDefinition>) => void): ReturnType<typeof goodDefinition> => { const d = goodDefinition(); fn(d); return d; };
  const bad = [
    mutate(d => { d.name = 'capture_belief'; }),
    mutate(d => { d.kind = 'client'; }),
    mutate(d => { d.config.method = 'GET'; }),
    mutate(d => { d.config.url = `${PUBLIC}/unblock/tool/`; }),
    mutate(d => { d.config.url = 'http://8and80.example/unblock/tool'; }),
    mutate(d => { d.config.url = 'https://attacker.example/unblock/tool'; }),
    mutate(d => { d.config.params.pop(); }),
    mutate(d => { d.config.params.push({ name: 'extra', type: 'string', required: false }); }),
    mutate(d => { d.config.params[0]!.required = false; }),
    mutate(d => { d.config.params.find(p => p.name === 'week')!.type = 'string'; }),
    mutate(d => { d.config.params.find(p => p.name === 'confirmed')!.required = true; }),
    mutate(d => { d.config.params[4] = { ...d.config.params[3]! }; }),
  ];
  for (const definition of bad) assert.throws(() => verifyToolDefinition(definition, PUBLIC), ToolSetupError);
  assert.throws(() => verifyToolDefinition(goodDefinition(), 'http://8and80.example'), /https/);
  assert.throws(() => unblockToolUrl('not a url'), ToolSetupError);
});

test('agent ids come from env, fall back to saved state, and must be three distinct values', () => {
  assert.deepEqual(resolveAgentIds({ UNBLOCK_OPENING_AGENT_ID: 'a', UNBLOCK_WEEKLY_AGENT_ID: 'b', UNBLOCK_LIGHT_AGENT_ID: 'c' }).map(v => v.id), ['a', 'b', 'c']);
  assert.deepEqual(resolveAgentIds({ UNBLOCK_WEEKLY_AGENT_ID: 'b' }, { 'unblock-opening': 'a', 'unblock-light': 'c' }).map(v => v.id), ['a', 'b', 'c']);
  assert.throws(() => resolveAgentIds({}, { 'unblock-opening': 'a' }), /not configured/);
  assert.throws(() => resolveAgentIds({ UNBLOCK_OPENING_AGENT_ID: 'a', UNBLOCK_WEEKLY_AGENT_ID: 'a', UNBLOCK_LIGHT_AGENT_ID: 'c' }), /distinct/);
});

function fakeProvider(definition: ReturnType<typeof goodDefinition> = goodDefinition()) {
  const bindings: Record<string, Binding[]> = {};
  for (const id of ['a_open', 'a_weekly', 'a_light']) bindings[id] = [{ id: 'tool_end', name: 'end_call', kind: 'builtin', enabled: true }];
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const files = new Map<string, string>(); const logs: string[] = []; let clock = 0;
  const io: ToolIo = {
    request: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path === '/v1/agents/tool-definitions/tool_cu') return definition as unknown as Record<string, unknown>;
      const parts = path.split('/');
      const list = bindings[parts[3]!]!; const tool = parts[5];
      if (path.endsWith('/tools')) return { tools: list, has_more: false };
      if (method === 'PUT') { list.push({ id: tool!, name: definition.name, kind: definition.kind, enabled: true, config: structuredClone(definition.config) }); return {}; }
      if (method === 'PATCH') { list.find(b => b.id === tool)!.enabled = (body as { enabled: boolean }).enabled; return {}; }
      throw new Error('unexpected');
    },
    write: (name, content) => { if (files.has(name)) throw new Error('exists'); files.set(name, content); },
    exists: name => files.has(name), remove: name => { files.delete(name); }, now: () => ++clock, log: line => logs.push(line),
  };
  const agents = [{ key: 'UNBLOCK_OPENING_AGENT_ID', id: 'a_open' }, { key: 'UNBLOCK_WEEKLY_AGENT_ID', id: 'a_weekly' }, { key: 'UNBLOCK_LIGHT_AGENT_ID', id: 'a_light' }] as const;
  const run = (mode: 'check' | 'prepare' | 'enable' | 'disable') => provisionUnblockTools({ mode, toolId: 'tool_cu', agents: [...agents], publicUrl: PUBLIC }, io);
  return { bindings, calls, files, logs, run };
}

test('prepare attaches disabled, enable turns it on, disable turns it off; end_call is preserved throughout', async () => {
  const p = fakeProvider();
  await assert.rejects(p.run('check'), /not attached/);
  assert.ok(p.calls.every(c => c.method === 'GET')); assert.equal(p.files.size, 0);
  await p.run('prepare');
  for (const id of ['a_open', 'a_weekly', 'a_light']) {
    const ours = p.bindings[id]!.find(b => b.id === 'tool_cu')!;
    assert.equal(ours.enabled, false); assert.ok(p.bindings[id]!.some(b => b.name === 'end_call' && b.enabled));
  }
  assert.ok([...p.files.keys()].some(k => k.startsWith('before-'))); assert.ok(![...p.files.keys()].some(k => k.startsWith('attach-')));
  await p.run('check');
  await p.run('enable');
  assert.ok(['a_open', 'a_weekly', 'a_light'].every(id => p.bindings[id]!.find(b => b.id === 'tool_cu')!.enabled));
  assert.ok(p.logs.at(-1)!.includes('ENABLED'));
  await p.run('disable');
  assert.ok(['a_open', 'a_weekly', 'a_light'].every(id => !p.bindings[id]!.find(b => b.id === 'tool_cu')!.enabled));
});

test('a wrong definition stops before any write or backup', async () => {
  const bad = goodDefinition(); bad.config.params.pop();
  const p = fakeProvider(bad);
  await assert.rejects(p.run('prepare'), ToolSetupError);
  assert.ok(p.calls.every(c => c.method === 'GET')); assert.equal(p.files.size, 0);
});

test('enable without prepare, and an unrelated capture_unblock binding, are refused without overwriting', async () => {
  const p = fakeProvider();
  await assert.rejects(p.run('enable'), /Prepare and verify/);
  assert.ok(!p.calls.some(c => c.method === 'PATCH' || c.method === 'PUT'));
  p.bindings['a_weekly']!.push({ id: 'other_tool', name: 'capture_unblock', kind: 'webhook', enabled: true });
  await assert.rejects(p.run('prepare'), /unrelated binding/);
  assert.ok(!p.calls.some(c => c.method === 'PUT'));
});

test('an unconfirmed earlier attachment blocks a repeated prepare', async () => {
  const p = fakeProvider(); p.files.set('attach-a_open-tool_cu.json', '{}');
  await assert.rejects(p.run('prepare'), /unconfirmed/);
  assert.ok(!p.calls.some(c => c.method === 'PUT'));
});

test('read-back fails if end_call is no longer enabled', async () => {
  const p = fakeProvider();
  await p.run('prepare');
  p.bindings['a_open']!.find(b => b.name === 'end_call')!.enabled = false;
  await assert.rejects(p.run('check'), /Read-back/);
});
