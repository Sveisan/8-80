import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { bindWeeklyFlow, weeklyFlow, WEEKLY_FLOW_POLICY } from '../agent/weekly-flow.ts';
import { flowGraph, privateFlowTargets } from '../agent/weekly-flow-sync.ts';
import { CONSOLE_VARIABLES } from '../prompt.ts';

type Json = Record<string, unknown>;
interface ReadOnlyFlowApi { request(method: 'GET', path: string): Promise<unknown>; }
const object = (v: unknown): Json => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Incomplete weekly release settings.');
  return v as Json;
};
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const catalogue = (values: unknown[]) => [...values].sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));

/** Verify effective, flow-owned prompts and speech. Never stage, publish, deactivate or change flags. */
export async function verifyWeeklyRelease(api: ReadOnlyFlowApi, env: NodeJS.ProcessEnv) {
  if (env['SPEECHIFY_SEND_VARIABLES'] !== '1') throw Error('Weekly dialogue requires server variables.');
  const roles = [], fingerprints = [];
  for (const { role, id } of privateFlowTargets(env)) {
    const values = await Promise.all(['', '/tools', '/variables', '/flow'].map(suffix => api.request('GET', `/v1/agents/${id}${suffix}`)));
    const [agent, tools, variables, heads] = values.map(object) as [Json, Json, Json, Json];
    if (agent['is_public'] !== false || object(agent['memory'])['enabled'] !== false || agent['save_audio_recording'] !== false
      || object(agent['amd'])['enabled'] !== true || object(object(agent['amd'])['on_voicemail'])['action'] !== 'hangup') throw Error('Weekly privacy or voicemail settings differ.');
    if (!Array.isArray(tools['tools']) || tools['has_more'] !== false || !Array.isArray(variables['variables']) || variables['has_more'] === true) throw Error('Incomplete weekly release catalogues.');
    const vars = variables['variables'].map(object);
    if (new Set(vars.map(v => v['key'])).size !== vars.length || CONSOLE_VARIABLES.some(key => !vars.some(v => v['key'] === key && v['type'] === 'string'))) throw Error('Weekly release variables differ.');
    if (Object.keys(heads).some(k => !['active', 'draft'].includes(k))) throw Error('Unknown weekly release flow heads.');
    const expected = flowGraph(bindWeeklyFlow(weeklyFlow(role), tools['tools']));
    const active = flowGraph(heads['active']), draft = flowGraph(heads['draft']);
    if (!isDeepStrictEqual(active, expected) || (draft !== null && !isDeepStrictEqual(draft, expected))) throw Error('Published weekly flow differs from the release.');
    // Top-level prompts can be legacy fallbacks. Effective prompts/greetings are checked in the complete active graph.
    const settings = Object.fromEntries(Object.entries(agent).filter(([key]) => !['created_at', 'updated_at', 'tools'].includes(key)));
    fingerprints.push({ role, id, settings, tools: catalogue(tools['tools']), variables: catalogue(vars), active, draft });
    roles.push({ role, activeMatches: true, draftMatches: draft === null ? null : true });
  }
  return { verified: true, policy: WEEKLY_FLOW_POLICY, roles, providerFingerprint: digest(fingerprints), configurationChanged: false, providerWrites: 0, phoneCallsPlaced: 0, messagesSent: 0 };
}
