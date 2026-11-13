import { isDeepStrictEqual } from 'node:util';
import { bindWeeklyFlow, weeklyFlow, weeklyFlowRoles, type WeeklyFlow, type WeeklyFlowRole } from './weekly-flow.ts';
import { dialogueAgentKeys } from '../weekly/dialogue-policy.ts';
import { agentKeys } from './prompt-pack.ts';
import { CONSOLE_VARIABLES } from '../prompt.ts';

type Json = Record<string, unknown>;
const object = (v: unknown): Json => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Unrecognised flow response.');
  return v as Json;
};
export type FlowMode = 'check' | 'stage' | 'activate' | 'deactivate';
export interface FlowApi { request(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<unknown>; }
export interface FlowState { version: 1; pending?: { role: WeeklyFlowRole; action: 'activate' | 'deactivate' }; }

export class SpeechifyFlowApi implements FlowApi {
  constructor(private readonly key: string, private readonly fetcher: typeof fetch = fetch) {
    if (!key || /[\r\n]/.test(key)) throw new Error('Speechify key is missing or invalid.');
  }
  async request(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const valid = method === 'GET' ? /^\/v1\/agents\/[a-zA-Z0-9_-]+(?:\/(?:tools|variables|flow(?:\/versions)?))?$/.test(path)
      : method === 'PUT' ? /^\/v1\/agents\/[a-zA-Z0-9_-]+\/flow$/.test(path)
        : /^\/v1\/agents\/[a-zA-Z0-9_-]+\/flow\/(?:publish|deactivate)$/.test(path);
    if (!valid) throw new Error('Unsupported weekly flow operation.');
    let response: Response;
    try {
      response = await this.fetcher('https://api.speechify.ai' + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(25000),
        headers: { authorization: 'Bearer ' + this.key, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error('Weekly flow request is unconfirmed; inspect saved state before any retry.'); }
    if (!response.ok) throw new Error(`Weekly flow request refused (HTTP ${response.status}); response withheld.`);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw new Error('Weekly flow response is unreadable.'); }
  }
}

/** Provider node/edge order and UI metadata are not execution semantics. */
export function flowGraph(value: unknown): WeeklyFlow | null {
  if (value == null) return null;
  const v = object(value);
  if (!Array.isArray(v['nodes']) || !Array.isArray(v['edges'])) throw new Error('Incomplete flow graph.');
  const nodes = v['nodes'].map(item => {
    const n = object(item);
    if (typeof n['key'] !== 'string' || !['start', 'say', 'subagent', 'end'].includes(String(n['type']))) throw new Error('Unexpected node in weekly flow.');
    return { key: n['key'], type: n['type'], config: n['config'] ?? {} };
  }).sort((a, b) => a.key.localeCompare(b.key));
  const edges = v['edges'].map(item => {
    const e = object(item);
    if (typeof e['from'] !== 'string' || typeof e['to'] !== 'string' || !['default', 'llm_condition'].includes(String(e['type']))) throw new Error('Unexpected edge in weekly flow.');
    return { from: e['from'], to: e['to'], type: e['type'], ...(e['condition'] ? { condition: e['condition'] } : {}) };
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { nodes, edges } as WeeklyFlow;
}
function heads(value: unknown): { active: WeeklyFlow | null; draft: WeeklyFlow | null } {
  const v = value == null ? {} : object(value);
  if (Object.keys(v).some(k => !['active', 'draft'].includes(k))) throw new Error('Unknown flow-head response.');
  return { active: flowGraph(v['active']), draft: flowGraph(v['draft']) };
}

export function privateFlowTargets(env: NodeJS.ProcessEnv): { role: WeeklyFlowRole; id: string }[] {
  const live = Object.values(agentKeys).map(k => env[k]).filter(Boolean);
  const result = weeklyFlowRoles.map(role => ({ role, id: env[dialogueAgentKeys[role]] ?? '' }));
  if (result.some(v => !/^agent_[a-zA-Z0-9_-]{1,120}$/.test(v.id) || live.includes(v.id)) || new Set(result.map(v => v.id)).size !== 4) throw new Error('Four distinct private pilot agents are required; live agents are refused.');
  return result;
}

export async function syncWeeklyFlows(api: FlowApi, options: {
  env: NodeJS.ProcessEnv; mode: FlowMode; ownerPilot: boolean; state: FlowState;
  saveState: (s: FlowState) => Promise<void>; backup: (v: unknown) => Promise<void>;
  assertIdle: () => Promise<void>;
}) {
  const { env, mode, state } = options, write = mode !== 'check';
  if (write && (!options.ownerPilot || env['WEEKLY_DIALOGUE_PILOT'] !== '1' || env['WEEKLY_DIALOGUE_READY'] === '1')) throw new Error('Flow writes require an isolated owner pilot; global rollout is refused.');
  const entries = [];
  for (const target of privateFlowTargets(env)) {
    const path = '/v1/agents/' + target.id;
    const agent = object(await api.request('GET', path));
    if (agent['is_public'] !== false || object(agent['memory'])['enabled'] !== false || agent['save_audio_recording'] !== false) throw new Error('Private, memory-free, recording-free pilot agents are required.');
    const catalog = object(await api.request('GET', path + '/tools'));
    if (catalog['has_more'] !== false) throw new Error('Complete pilot bindings are required.');
    const graph = bindWeeklyFlow(weeklyFlow(target.role), catalog['tools']);
    const variables = object(await api.request('GET', path + '/variables'))['variables'];
    if (!Array.isArray(variables) || CONSOLE_VARIABLES.some(key => !variables.some(v => v.key === key))) throw new Error('The weekly variable catalog is incomplete.');
    const original = await api.request('GET', path + '/flow'), current = heads(original);
    const expected = flowGraph(graph)!;
    if ([current.active, current.draft].some(g => g !== null && !isDeepStrictEqual(g, expected))) throw new Error('An unrelated flow exists; it was not overwritten.');
    entries.push({ ...target, path, graph, expected, current, original });
  }
  if (state.pending) {
    const e = entries.find(e => e.role === state.pending!.role);
    const confirmed = e && (state.pending.action === 'activate' ? isDeepStrictEqual(e.current.active, e.expected) : e.current.active === null);
    if (!confirmed) throw new Error('An earlier flow activation is unconfirmed; no publish request was repeated.');
    delete state.pending; await options.saveState(state);
  }
  if (write) {
    await options.assertIdle();
    await options.backup({ version: 1, at: new Date().toISOString(), agents: entries.map(e => ({ role: e.role, id: e.id, flow: e.original })) });
  }
  const report = [];
  for (const e of entries) {
    let current = e.current;
    if (mode === 'stage' || mode === 'activate') {
      if (!isDeepStrictEqual(current.draft, e.expected) && !isDeepStrictEqual(current.active, e.expected)) {
        await options.assertIdle();
        const result = await api.request('PUT', e.path + '/flow', e.graph);
        if (!isDeepStrictEqual(flowGraph(result), e.expected)) throw new Error('Flow draft read-back did not match source.');
        current = heads(await api.request('GET', e.path + '/flow'));
        if (!isDeepStrictEqual(current.draft, e.expected)) throw new Error('The flow draft was not retained.');
      }
      if (mode === 'activate' && !isDeepStrictEqual(current.active, e.expected)) {
        await options.assertIdle();
        state.pending = { role: e.role, action: 'activate' }; await options.saveState(state);
        await api.request('POST', e.path + '/flow/publish');
        current = heads(await api.request('GET', e.path + '/flow'));
        if (!isDeepStrictEqual(current.active, e.expected)) throw new Error('Published flow is unconfirmed; no automatic retry.');
        delete state.pending; await options.saveState(state);
      }
    } else if (mode === 'deactivate' && current.active !== null) {
      await options.assertIdle();
      state.pending = { role: e.role, action: 'deactivate' }; await options.saveState(state);
      await api.request('POST', e.path + '/flow/deactivate');
      current = heads(await api.request('GET', e.path + '/flow'));
      if (current.active !== null) throw new Error('Flow deactivation is unconfirmed.');
      delete state.pending; await options.saveState(state);
    }
    report.push({ role: e.role, draftMatches: isDeepStrictEqual(current.draft, e.expected), activeMatches: isDeepStrictEqual(current.active, e.expected), inactive: current.active === null });
  }
  return { policy: 'weekly-answer-and-farewell-v1', roles: report, mode, voiceApproved: false, phoneTestRequired: true, callsStarted: 0, messagesSent: 0 };
}
