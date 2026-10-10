import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { agentKeys, type AgentRole, type PromptSpec } from './prompt-pack.ts';

type Json = Record<string, unknown>;
export interface Variable extends Json { key: string; type: string; }
export interface SyncState { version: 1; ids: Partial<Record<AgentRole, string>>; pending?: { role: AgentRole; key: string; since: string; hash: string }; }
export interface Backup { version: 1; at: string; agents: { role: AgentRole; id: string; agent: Json; variables: Variable[] }[]; }
export interface SyncReport { role: AgentRole; id: string; changed: boolean; created: boolean; tools: 'present' | 'unverified'; }
export interface SyncOptions {
  specs: PromptSpec[]; env: NodeJS.ProcessEnv; state: SyncState; apply: boolean;
  saveState: (state: SyncState) => Promise<void>; saveBackup: (backup: Backup) => Promise<void>; now?: Date;
}
const record = (v: unknown): Json => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Speechify returned an unexpected response shape.');
  return v as Json;
};
export function resourceId(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(v)) throw new Error('Speechify returned an invalid resource identifier.');
  return v;
}
export function parseState(v: unknown): SyncState {
  const value = record(v); if (value['version'] !== 1) throw new Error('Unsupported Speechify sync state.');
  const ids: SyncState['ids'] = {};
  for (const [role, id] of Object.entries(record(value['ids']))) {
    if (!Object.hasOwn(agentKeys, role)) throw new Error('Unexpected role in Speechify sync state.');
    ids[role as AgentRole] = resourceId(id);
  }
  const pending = value['pending'] === undefined ? undefined : record(value['pending']);
  if (pending && (!Object.hasOwn(agentKeys, String(pending['role'])) || typeof pending['key'] !== 'string' || !/^[0-9a-f-]{36}$/.test(pending['key']) || !/^[0-9a-f]{64}$/.test(String(pending['hash'])) || !Number.isFinite(Date.parse(String(pending['since']))))) throw new Error('Invalid pending Speechify setup.');
  return { version: 1, ids, ...(pending ? { pending: { role: pending['role'] as AgentRole, key: pending['key'] as string, since: pending['since'] as string, hash: pending['hash'] as string } } : {}) };
}
/** Never include provider errors/bodies, request headers, prompts or variable values in diagnostics. */
export class SpeechifySettingsApi {
  constructor(private readonly key: string, private readonly fetcher: typeof fetch = fetch) {
    if (!key || /[\r\n]/.test(key)) throw new Error('SPEECHIFY_API_KEY is missing or invalid.');
  }
  async request(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, idempotency?: string): Promise<unknown> {
    if (!/^\/v1\/agents(?:\/[a-zA-Z0-9_-]+)?(?:\/variables)?$/.test(path)) throw new Error('Unsupported Speechify settings endpoint.');
    let response: Response;
    try {
      response = await this.fetcher(`https://api.speechify.ai${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${this.key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('Speechify settings request was not confirmed. Rerun with the saved setup state; do not create a second agent manually.'); }
    if (!response.ok) throw new Error(`Speechify refused the settings request (HTTP ${response.status}). No provider response body was printed.`);
    if (response.status === 204) return {};
    try { return await response.json(); } catch { throw new Error('Speechify returned an unreadable settings response.'); }
  }
  async agent(id: string): Promise<Json> { return record(await this.request('GET', `/v1/agents/${resourceId(id)}`)); }
  async variables(id: string): Promise<Variable[]> {
    const response = record(await this.request('GET', `/v1/agents/${resourceId(id)}/variables`));
    if (!Array.isArray(response['variables'])) throw new Error('Speechify variable catalog format is unrecognised; nothing was replaced.');
    const variables = response['variables'].map(v => {
      const entry = record(v);
      if (typeof entry['key'] !== 'string' || typeof entry['type'] !== 'string') throw new Error('Speechify variable catalog is invalid; nothing was replaced.');
      return Object.fromEntries(['key', 'type', 'default', 'description'].filter(k => Object.hasOwn(entry, k)).map(k => [k, entry[k]])) as Variable;
    });
    if (new Set(variables.map(v => v.key)).size !== variables.length) throw new Error('Speechify variable catalog contains duplicate keys.');
    return variables;
  }
}
export function mergeVariables(current: Variable[], required: string[]): Variable[] {
  const variables = current.map(v => ({ ...v }));
  for (const key of required) if (!variables.some(v => v.key === key)) variables.push({ key, type: 'string', default: '', description: 'Supplied by the 8&80 server for each call.' });
  if (variables.length > 20) throw new Error('Adding the required variables would exceed Speechify’s 20-variable limit. No catalog was replaced.');
  return variables;
}
function fieldsMatch(actual: Json, wanted: Json): boolean {
  return Object.entries(wanted).every(([key, value]) => {
    const got = actual[key];
    return value && typeof value === 'object' && !Array.isArray(value) ? !!got && typeof got === 'object' && !Array.isArray(got) && fieldsMatch(got as Json, value as Json) : isDeepStrictEqual(got, value);
  });
}
const ownedFields = ['prompt', 'webhook_url', 'memory', 'amd', 'save_audio_recording'] as const;
/** JSON Merge Patch needs nulls to remove settings introduced after a snapshot. */
function restorePatch(before: Json, current: Json): Json {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(current)])].map(key => {
    if (!Object.hasOwn(before, key)) return [key, null];
    const value = before[key]; const got = current[key];
    return [key, value && typeof value === 'object' && !Array.isArray(value) && got && typeof got === 'object' && !Array.isArray(got) ? restorePatch(value as Json, got as Json) : value];
  }));
}
function restoredFieldsMatch(actual: Json, before: Json): boolean {
  return [...new Set([...Object.keys(actual), ...Object.keys(before)])].every(key => {
    const value = before[key]; const got = actual[key];
    if (!Object.hasOwn(before, key) || value === null) return got === undefined || got === null;
    return value && typeof value === 'object' && !Array.isArray(value) ? !!got && typeof got === 'object' && !Array.isArray(got) && restoredFieldsMatch(got as Json, value as Json) : isDeepStrictEqual(value, got);
  });
}
function toolsPresent(agent: Json, beliefs: boolean): boolean {
  const tools = agent['tools']; if (!Array.isArray(tools)) return false;
  const names = tools.flatMap(t => { if (!t || typeof t !== 'object' || Array.isArray(t)) return []; const v = record(t); const c = typeof v['config'] === 'object' && v['config'] ? record(v['config']) : {}; return [v['name'], c['builtin']]; });
  return names.includes('end_call') && (!beliefs || names.includes('capture_belief'));
}
function privateUrl(value: string | undefined): string {
  try {
    const url = new URL(value ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    return new URL('/webhooks/speechify', url).href;
  } catch { throw new Error('Set a credential-free HTTPS PUBLIC_URL before provisioning agents.'); }
}
export async function syncAgents(api: SpeechifySettingsApi, options: SyncOptions): Promise<SyncReport[]> {
  const { specs, env, state, apply } = options; const now = options.now ?? new Date();
  const resolved = specs.map(spec => ({ spec, id: env[agentKeys[spec.role]]?.trim() || state.ids[spec.role] }));
  const ids = resolved.flatMap(v => v.id ? [resourceId(v.id)] : []);
  if (new Set(ids).size !== ids.length) throw new Error('Two roles point to the same agent. Separate the IDs before uploading different prompts.');
  // Agent-creation idempotency has not been confirmed for this beta endpoint.
  // Keep the key, but never replay an uncertain POST on that assumption alone.
  if (apply && state.pending && !resolved.some(v => v.spec.role === state.pending!.role && v.id)) throw new Error('An earlier create request remains unconfirmed. Find that agent in Speechify and set its role’s agent ID before rerunning; no second create request was sent.');
  const templateId = env['SPEECHIFY_AGENT_ID']?.trim() || state.ids.return;
  const template = resolved.some(v => !v.id) && templateId ? await api.agent(templateId) : undefined;
  const templateTts = template?.['tts'] && typeof template['tts'] === 'object' ? record(template['tts']) : undefined;
  const voice = env['SPEECHIFY_SETUP_VOICE_ID']?.trim() || templateTts?.['voice_id'];
  const entries: { spec: PromptSpec; id?: string; agent?: Json; currentVariables: Variable[]; variables: Variable[]; wanted: Json; create?: Json }[] = [];
  for (const { spec, id } of resolved) {
    const beliefs = spec.role.startsWith('belief-');
    const agent = id ? await api.agent(id) : undefined;
    const currentVariables = id ? await api.variables(id) : [];
    const variables = mergeVariables(currentVariables, spec.variables);
    const wanted: Json = { prompt: spec.prompt };
    if (beliefs) Object.assign(wanted, { memory: { enabled: false }, amd: { enabled: true, on_voicemail: { action: 'hangup' }, on_unavailable: { action: 'hangup' } }, save_audio_recording: false, webhook_url: privateUrl(env['PUBLIC_URL']) });
    let create: Json | undefined;
    if (!id) {
      if (typeof voice !== 'string' || !voice) throw new Error('New agents need SPEECHIFY_SETUP_VOICE_ID or an existing SPEECHIFY_AGENT_ID with a voice.');
      const secret = env['SPEECHIFY_WEBHOOK_SECRET']?.split(',')[0]?.trim();
      if (!secret) throw new Error('SPEECHIFY_WEBHOOK_SECRET is required to create signed callbacks.');
      create = { name: spec.name, kind: 'voice', ...wanted, prompt: 'This agent is being configured. Do not begin a conversation.', tts: { voice_id: voice }, language: typeof template?.['language'] === 'string' ? template['language'] : 'en', first_message: '', is_public: false, webhook_url: privateUrl(env['PUBLIC_URL']), webhook_secret: secret };
    }
    entries.push({ spec, id, agent, currentVariables, variables, wanted, create });
  }
  if (apply && state.pending) {
    const recovered = entries.find(e => e.spec.role === state.pending!.role);
    if (!recovered?.id || recovered.agent?.['name'] !== recovered.spec.name || recovered.agent?.['is_public'] !== false) throw new Error('The supplied recovery ID does not identify the expected private setup agent. No configuration was changed.');
  }
  // Read and validate every selected agent before the first provider write.
  if (apply) await options.saveBackup({ version: 1, at: now.toISOString(), agents: entries.flatMap(e => e.id && e.agent ? [{ role: e.spec.role, id: e.id, agent: Object.fromEntries(ownedFields.filter(k => Object.hasOwn(e.agent!, k)).map(k => [k, e.agent![k]])), variables: e.currentVariables }] : []) });
  if (apply && state.pending) { delete state.pending; await options.saveState(state); }
  const reports: SyncReport[] = [];
  for (const entry of entries) {
    const { spec, wanted, variables } = entry;
    let id = entry.id; let created = false;
    const variablesChanged = !isDeepStrictEqual(entry.currentVariables, variables);
    const settingsChanged = !entry.agent || !fieldsMatch(entry.agent, wanted);
    const changed = settingsChanged || variablesChanged;
    if (!apply) { reports.push({ role: spec.role, id: id ?? '', changed, created: !id, tools: entry.agent && toolsPresent(entry.agent, spec.role.startsWith('belief-')) ? 'present' : 'unverified' }); continue; }
    if (!id) {
      const hash = createHash('sha256').update(JSON.stringify(entry.create)).digest('hex');
      const pending = { role: spec.role, key: randomUUID(), since: now.toISOString(), hash };
      state.pending = pending; await options.saveState(state);
      const result = record(await api.request('POST', '/v1/agents', entry.create, pending.key));
      id = resourceId(result['id']); state.ids[spec.role] = id; delete state.pending; await options.saveState(state); created = true;
    }
    // Declare variables first: the provider rejects prompts referring to missing keys.
    if (created || variablesChanged) await api.request('PUT', `/v1/agents/${id}/variables`, { variables });
    if (created || settingsChanged) await api.request('PATCH', `/v1/agents/${id}`, wanted);
    const actual = await api.agent(id); const actualVariables = await api.variables(id);
    if (!fieldsMatch(actual, wanted) || variables.some(v => !actualVariables.some(a => fieldsMatch(a, v)))) throw new Error('Speechify did not retain the requested settings. A private backup is available; routing IDs were not written.');
    state.ids[spec.role] = id; await options.saveState(state);
    reports.push({ role: spec.role, id, changed, created, tools: toolsPresent(actual, spec.role.startsWith('belief-')) ? 'present' : 'unverified' });
  }
  return reports;
}
export async function restoreAgents(api: SpeechifySettingsApi, input: unknown): Promise<number> {
  const backup = record(input);
  if (backup['version'] !== 1 || !Array.isArray(backup['agents'])) throw new Error('Invalid Speechify backup.');
  const entries = backup['agents'].map(v => {
    const entry = record(v); const settings = record(entry['agent']);
    if (Object.keys(settings).some(k => !ownedFields.includes(k as typeof ownedFields[number])) || typeof settings['prompt'] !== 'string' || !Array.isArray(entry['variables'])) throw new Error('Invalid Speechify backup settings.');
    const variables = entry['variables'].map(v => { const item = record(v); if (typeof item['key'] !== 'string' || typeof item['type'] !== 'string') throw new Error('Invalid backup variable.'); return item; });
    return { id: resourceId(entry['id']), settings, variables };
  });
  const originals: Json[] = [];
  for (const entry of entries) originals.push(await api.agent(entry.id));
  let index = 0;
  for (const { id, settings, variables } of entries) {
    // The old prompt's variables still exist in the merged catalog until this restore.
    const current = Object.fromEntries(ownedFields.filter(k => Object.hasOwn(originals[index]!, k)).map(k => [k, originals[index]![k]])); index++;
    await api.request('PATCH', `/v1/agents/${id}`, restorePatch(settings, current));
    await api.request('PUT', `/v1/agents/${id}/variables`, { variables });
    const agent = await api.agent(id); const catalog = await api.variables(id);
    const restored = Object.fromEntries(ownedFields.filter(k => Object.hasOwn(agent, k)).map(k => [k, agent[k]]));
    if (!restoredFieldsMatch(restored, settings) || catalog.length !== variables.length || variables.some(v => !catalog.some(a => fieldsMatch(a, v)))) throw new Error('Speechify restore was not verified.');
  }
  return entries.length;
}
/** Used to compare an offline source pack without printing prompts or personal defaults. */
export const promptDigest = (prompt: string): string => createHash('sha256').update(prompt).digest('hex').slice(0, 12);
/** Only route identifiers may be changed; no API keys or launch flags are written. */
export function mergeAgentIds(source: string, ids: SyncState['ids']): string {
  let result = source;
  for (const [role, id] of Object.entries(ids)) {
    if (!Object.hasOwn(agentKeys, role)) throw new Error('Unexpected routing role.');
    const key = agentKeys[role as AgentRole]; const line = `${key}=${resourceId(id)}`;
    const pattern = new RegExp(`^[\\t ]*(?:export[\\t ]+)?${key}[\\t ]*=.*$`, 'gm');
    let found = false;
    result = result.replace(pattern, () => { if (found) return ''; found = true; return line; });
    if (!found) result = `${result}${result.endsWith('\n') || !result ? '' : '\n'}${line}\n`;
  }
  return result;
}
