import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { agentKeys, isManagedModuleRole, moduleToolName, type AgentRole, type PromptSpec } from './prompt-pack.ts';

type Json = Record<string, unknown>;
export interface Variable extends Json { key: string; type: string; }
export interface SyncState { version: 1; ids: Partial<Record<AgentRole, string>>; pending?: { role: AgentRole; key: string; since: string; hash: string }; }
export interface Backup { version: 1; at: string; agents: { role: AgentRole; id: string; agent: Json; variables: Variable[]; endCall?:{id:string;description:string} }[]; }
export interface SyncReport { role: AgentRole; id: string; changed: boolean; created: boolean; tools: 'present' | 'unverified'; }
export interface SyncOptions {
  specs: PromptSpec[]; env: NodeJS.ProcessEnv; state: SyncState; apply: boolean;
  saveState: (state: SyncState) => Promise<void>; saveBackup: (backup: Backup) => Promise<void>; now?: Date;
  onReport?: (report: SyncReport) => void;
  /** Private clone configuration; never set by the ordinary live-agent CLI. */
  dialoguePilot?:boolean;
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
const validationFields = new Set(['name', 'kind', 'prompt', 'slug', 'tts', 'voice_id', 'language', 'first_message', 'is_public', 'webhook_url', 'webhook_secret', 'memory', 'enabled', 'retention_days', 'amd', 'on_voicemail', 'on_ivr', 'on_unavailable', 'action', 'message', 'save_audio_recording', 'variables', 'key', 'type', 'default', 'description']);
/** Emit only known schema paths, never provider messages, inputs or unknown keys. */
function safeValidationFields(value: unknown): string[] {
  const fields = new Set<string>();
  function visit(v: unknown, depth: number): void {
    if (depth > 8 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const child of v.slice(0, 100)) visit(child, depth + 1); return; }
    const item = v as Json;
    for (const key of ['loc', 'path', 'field']) {
      const path = item[key];
      const parts = Array.isArray(path) ? path : typeof path === 'string' ? path.split('.') : [];
      const names = parts.filter(p => p !== 'body' && typeof p !== 'number');
      if (names.length && names.every(p => typeof p === 'string' && validationFields.has(p))) fields.add(names.join('.'));
    }
    for (const key of ['error', 'errors', 'details', 'detail', 'issues']) visit(item[key], depth + 1);
  }
  visit(value, 0); return [...fields].sort();
}
export class SpeechifySettingsError extends Error {
  constructor(readonly status: number, method: string, path: string, value: unknown) {
    const endpoint = path === '/v1/agents' ? path : path.endsWith('/variables') ? '/v1/agents/{id}/variables' : '/v1/agents/{id}';
    const fields = safeValidationFields(value);
    const v = value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
    const error = v['error'] && typeof v['error'] === 'object' && !Array.isArray(v['error']) ? v['error'] as Json : v;
    // Speechify also uses this exact generic message for nested schema failures.
    const validation = error['message'] === 'Request body is not valid JSON' ? '; request body failed validation' : '';
    super(`Speechify rejected ${method} ${endpoint} (HTTP ${status}${validation})${fields.length ? `; validation fields: ${fields.join(', ')}` : ''}. No provider response body was printed.`);
    this.name = 'SpeechifySettingsError';
  }
}
/** Never include raw provider errors/bodies, request headers, prompts or variable values in diagnostics. */
export class SpeechifySettingsApi {
  constructor(private readonly key: string, private readonly fetcher: typeof fetch = fetch) {
    if (!key || /[\r\n]/.test(key)) throw new Error('SPEECHIFY_API_KEY is missing or invalid.');
  }
  async request(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown, idempotency?: string): Promise<unknown> {
    if (!/^\/v1\/agents(?:\/[a-zA-Z0-9_-]+)?(?:\/variables|\/tools(?:\/[a-zA-Z0-9_-]+)?)?$/.test(path)) throw new Error('Unsupported Speechify settings endpoint.');
    if (path.endsWith('/tools') && method !== 'GET') throw new Error('Tool writes are outside the settings sync.');
    if(/\/tools\/[^/]+$/.test(path)&&(method!=='PATCH'||!body||Object.keys(record(body)).some(k=>k!=='description')||typeof record(body)['description']!=='string'))throw new Error('Only a built-in tool description may be synchronized.');
    let response: Response;
    try {
      response = await this.fetcher(`https://api.speechify.ai${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${this.key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new Error('Speechify settings request was not confirmed. Rerun with the saved setup state; do not create a second agent manually.'); }
    if (!response.ok) {
      let value: unknown; try { value = await response.json(); } catch { /* Non-JSON errors are deliberately withheld. */ }
      throw new SpeechifySettingsError(response.status, method, path, value);
    }
    if (response.status === 204) return {};
    try { return await response.json(); } catch { throw new Error('Speechify returned an unreadable settings response.'); }
  }
  async agent(id: string): Promise<Json> {
    const key=resourceId(id);
    const agent=record(await this.request('GET', `/v1/agents/${key}`));
    // The live API lists bindings separately; older fixtures included them inline.
    if (!Array.isArray(agent['tools'])) {
      const bindings=record(await this.request('GET', `/v1/agents/${key}/tools`));
      if (!Array.isArray(bindings['tools']) || bindings['has_more']===true) throw new Error('The complete Speechify tool bindings could not be verified.');
      agent['tools']=bindings['tools'];
    }
    return agent;
  }
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
const ownedFields = ['prompt', 'first_message', 'webhook_url', 'memory', 'amd', 'save_audio_recording', 'tts'] as const;
/** JSON Merge Patch needs nulls to remove settings introduced after a snapshot. */
function restorePatch(before: Json, current: Json): Json {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(current)])].map(key => {
    if (!Object.hasOwn(before, key)) return [key, null];
    const value = before[key]; const got = current[key];
    // AMD is replaced wholesale by Speechify, unlike memory's merge-patch semantics.
    return [key, key !== 'amd' && value && typeof value === 'object' && !Array.isArray(value) && got && typeof got === 'object' && !Array.isArray(got) ? restorePatch(value as Json, got as Json) : value];
  }));
}
function restoredFieldsMatch(actual: Json, before: Json): boolean {
  return [...new Set([...Object.keys(actual), ...Object.keys(before)])].every(key => {
    const value = before[key]; const got = actual[key];
    if (!Object.hasOwn(before, key) || value === null) return got === undefined || got === null;
    return value && typeof value === 'object' && !Array.isArray(value) ? !!got && typeof got === 'object' && !Array.isArray(got) && restoredFieldsMatch(got as Json, value as Json) : isDeepStrictEqual(value, got);
  });
}
function toolsPresent(agent: Json, moduleTool: string | undefined, weekly = false): boolean {
  const tools = agent['tools']; if (!Array.isArray(tools)) return false;
  const names = tools.flatMap(t => { if (!t || typeof t !== 'object' || Array.isArray(t)) return []; const v = record(t); if(v['enabled']===false)return []; const c = typeof v['config'] === 'object' && v['config'] ? record(v['config']) : {}; return [v['name'], c['builtin']]; });
  return names.includes('end_call') && (!moduleTool || names.includes(moduleTool)) && (!weekly || names.includes('weekly_assist'));
}
function endCall(agent:Json):Json|undefined {
  const tools=agent['tools'];if(!Array.isArray(tools))return undefined;
  const found=tools.filter(t=>t&&typeof t==='object'&&t.kind==='builtin'&&t.name==='end_call'&&t.config?.builtin==='end_call'&&typeof t.id==='string');
  return found.length===1?found[0] as Json:undefined;
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
  if(apply&&env['WEEKLY_DIALOGUE_PILOT']==='1'&&env['WEEKLY_DIALOGUE_READY']!=='1'&&!options.dialoguePilot&&specs.some(s=>!isManagedModuleRole(s.role)))throw new Error('Dialogue changes are held in pilot. Use the dialogue pilot setup; live weekly agents require a successful phone test before promotion.');
  const resolved = specs.map(spec => ({ spec, id: env[agentKeys[spec.role]]?.trim() || state.ids[spec.role] }));
  const ids = resolved.flatMap(v => v.id ? [resourceId(v.id)] : []);
  if (new Set(ids).size !== ids.length) throw new Error('Two roles point to the same agent. Separate the IDs before uploading different prompts.');
  if (resolved.some(v => v.spec.role.startsWith('female-'))) {
    const all = Object.entries(agentKeys).flatMap(([role, key]) => { const id = env[key]?.trim() || state.ids[role as AgentRole]; return id ? [resourceId(id)] : []; });
    if (new Set(all).size !== all.length) throw new Error('Two roles point to the same agent. Female agents must be separate from every existing agent.');
  }
  // Agent-creation idempotency has not been confirmed for this beta endpoint.
  // Keep the key, but never replay an uncertain POST on that assumption alone.
  if (apply && state.pending && !resolved.some(v => v.spec.role === state.pending!.role && v.id)) throw new Error('An earlier create request remains unconfirmed. Find that agent in Speechify and set its role’s agent ID before rerunning; no second create request was sent.');
  const templateId = env['SPEECHIFY_AGENT_ID']?.trim() || state.ids.return;
  const template = resolved.some(v => !v.id) && templateId ? await api.agent(templateId) : undefined;
  const templateTts = template?.['tts'] && typeof template['tts'] === 'object' ? record(template['tts']) : undefined;
  const voice = env['SPEECHIFY_SETUP_VOICE_ID']?.trim() || templateTts?.['voice_id'];
  const entries: { spec: PromptSpec; id?: string; agent?: Json; currentVariables: Variable[]; variables: Variable[]; wanted: Json; create?: Json }[] = [];
  for (const { spec, id } of resolved) {
    const beliefs = isManagedModuleRole(spec.role);
    const female = spec.role.startsWith('female-');
    const femaleVoice = env['SPEECHIFY_FEMALE_VOICE_ID']?.trim();
    if (female && !femaleVoice) throw new Error('Set SPEECHIFY_FEMALE_VOICE_ID to a verified female voice before syncing the female agents.');
    const agent = id ? await api.agent(id) : undefined;
    const currentVariables = id ? await api.variables(id) : [];
    const variables = mergeVariables(currentVariables, spec.variables);
    const wanted: Json = { prompt: spec.prompt,...(spec.firstMessage!==undefined?{first_message:spec.firstMessage}:{}) };
    // All three routing branches are required, even when only voicemail/unavailable behaviour changes.
    if (beliefs) Object.assign(wanted, { first_message: spec.firstMessage ?? '', memory: { enabled: false }, amd: { enabled: true, on_voicemail: { action: 'hangup' }, on_ivr: { action: 'proceed' }, on_unavailable: { action: 'hangup' } }, save_audio_recording: false, webhook_url: privateUrl(env['PUBLIC_URL']) });
    if (female) Object.assign(wanted, { tts: { voice_id: femaleVoice }, memory: { enabled: false }, amd: { enabled: true, on_voicemail: { action: 'hangup' }, on_ivr: { action: 'proceed' }, on_unavailable: { action: 'hangup' } }, save_audio_recording: false, webhook_url: privateUrl(env['PUBLIC_URL']) });
    let create: Json | undefined;
    if (!id) {
      const selectedVoice = female ? femaleVoice : voice;
      if (typeof selectedVoice !== 'string' || !selectedVoice) throw new Error('New agents need SPEECHIFY_SETUP_VOICE_ID or an existing SPEECHIFY_AGENT_ID with a voice.');
      const secret = env['SPEECHIFY_WEBHOOK_SECRET']?.split(',')[0]?.trim();
      if (!secret) throw new Error('SPEECHIFY_WEBHOOK_SECRET is required to create signed callbacks.');
      create = { name: spec.name, kind: 'voice', ...wanted, prompt: 'This agent is being configured. Do not begin a conversation.', tts: { voice_id: selectedVoice }, language: typeof template?.['language'] === 'string' ? template['language'] : 'en', first_message: '', is_public: false, webhook_url: privateUrl(env['PUBLIC_URL']), webhook_secret: secret };
    }
    if (female && !id) {
      const sourceId = spec.role === 'female-first' ? env['SPEECHIFY_FIRST_CALL_AGENT_ID'] : env['SPEECHIFY_AGENT_ID'];
      if (!sourceId) throw new Error('Configure both existing weekly agents before adding a female pair.');
      const source = await api.agent(resourceId(sourceId));
      if (!toolsPresent(source, undefined)) throw new Error('The source weekly agent must have end_call configured before adding a female pair.');
      if (typeof source['first_message'] !== 'string') throw new Error('The source weekly greeting could not be read.');
      wanted['first_message'] = spec.firstMessage??source['first_message'];
      if (create) {
        create['first_message'] = '';
        create['language'] = source['language'] ?? 'en';
        create['tts'] = { ...record(source['tts']), voice_id: femaleVoice };
      }
    }
    entries.push({ spec, id, agent, currentVariables, variables, wanted, create });
  }
  if (apply && state.pending) {
    const recovered = entries.find(e => e.spec.role === state.pending!.role);
    if (!recovered?.id || recovered.agent?.['name'] !== recovered.spec.name || recovered.agent?.['is_public'] !== false) throw new Error('The supplied recovery ID does not identify the expected private setup agent. No configuration was changed.');
  }
  // Read and validate every selected agent before the first provider write.
  if (apply) await options.saveBackup({ version: 1, at: now.toISOString(), agents: entries.flatMap(e => e.id && e.agent ? [{ role: e.spec.role, id: e.id, agent: Object.fromEntries(ownedFields.filter(k => Object.hasOwn(e.agent!, k) && (k !== 'first_message' || e.spec.firstMessage!==undefined || isManagedModuleRole(e.spec.role) || e.spec.role.startsWith('female-')) && (k !== 'tts' || e.spec.role.startsWith('female-'))).map(k => [k, e.agent![k]])), variables: e.currentVariables,...(e.spec.endCallDescription&&endCall(e.agent)?{endCall:{id:resourceId(endCall(e.agent)!['id']),description:String(endCall(e.agent)!['description']??'')}}:{}) }] : []) });
  if (apply && state.pending) { delete state.pending; await options.saveState(state); }
  const reports: SyncReport[] = [];
  for (const entry of entries) {
    const { spec, wanted, variables } = entry;
    let id = entry.id; let created = false;
    const variablesChanged = !isDeepStrictEqual(entry.currentVariables, variables);
    const settingsChanged = !entry.agent || !fieldsMatch(entry.agent, wanted);
    const toolBefore=entry.agent?endCall(entry.agent):undefined;
    const toolChanged=!!spec.endCallDescription&&toolBefore?.['description']!==spec.endCallDescription;
    const ready=(agent:Json)=>toolsPresent(agent,moduleToolName(spec.role),!isManagedModuleRole(spec.role)&&env['WEEKLY_TOOLS_READY']==='1')&&(!spec.endCallDescription||endCall(agent)?.['description']===spec.endCallDescription)
      && (!options.dialoguePilot || isManagedModuleRole(spec.role) || (agent['tools'] as Json[]).some(t=>t['kind']==='builtin'&&t['name']==='skip_turn'&&t['enabled']!==false&&record(t['config'])['builtin']==='skip_turn'));
    const changed = settingsChanged || variablesChanged || toolChanged;
    if (!apply) {
      const report: SyncReport = { role: spec.role, id: id ?? '', changed, created: !id, tools: entry.agent && ready(entry.agent) ? 'present' : 'unverified' };
      reports.push(report); options.onReport?.(report); continue;
    }
    if (!id) {
      const hash = createHash('sha256').update(JSON.stringify(entry.create)).digest('hex');
      const pending = { role: spec.role, key: randomUUID(), since: now.toISOString(), hash };
      state.pending = pending; await options.saveState(state);
      let result: Json;
      try { result = record(await api.request('POST', '/v1/agents', entry.create, pending.key)); }
      catch (error) { if (error instanceof SpeechifySettingsError) throw new Error(`${spec.role}: ${error.message}`); throw error; }
      id = resourceId(result['id']); state.ids[spec.role] = id; delete state.pending; await options.saveState(state); created = true;
    }
    // Declare variables first: the provider rejects prompts referring to missing keys.
    if (created || variablesChanged) await api.request('PUT', `/v1/agents/${id}/variables`, { variables });
    if (created || settingsChanged) await api.request('PATCH', `/v1/agents/${id}`, wanted);
    const tool=created?endCall(await api.agent(id)):toolBefore;
    if(spec.endCallDescription&&tool&&tool['description']!==spec.endCallDescription)await api.request('PATCH',`/v1/agents/${id}/tools/${resourceId(tool['id'])}`,{description:spec.endCallDescription});
    const actual = await api.agent(id); const actualVariables = await api.variables(id);
    if (!fieldsMatch(actual, wanted) || variables.some(v => !actualVariables.some(a => fieldsMatch(a, v)))) throw new Error('Speechify did not retain the requested settings. A private backup is available; routing IDs were not written.');
    if(tool&&spec.endCallDescription&&endCall(actual)?.['description']!==spec.endCallDescription)throw new Error('Speechify did not retain the end-call instructions.');
    state.ids[spec.role] = id; await options.saveState(state);
    const report: SyncReport = { role: spec.role, id, changed, created, tools: ready(actual) ? 'present' : 'unverified' };
    reports.push(report); options.onReport?.(report);
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
    const tool=entry['endCall']===undefined?undefined:record(entry['endCall']);
    if(tool&&typeof tool['description']!=='string')throw new Error('Invalid built-in backup.');
    return { id: resourceId(entry['id']), settings, variables,...(tool?{endCall:{id:resourceId(tool['id']),description:tool['description'] as string}}:{}) };
  });
  const originals: Json[] = [];
  for (const entry of entries) originals.push(await api.agent(entry.id));
  entries.forEach((entry,i)=>{if(entry.endCall&&endCall(originals[i]!)?.['id']!==entry.endCall.id)throw new Error('The end-call backup does not match this agent.');});
  let index = 0;
  for (const { id, settings, variables,endCall:toolBackup } of entries) {
    // Older restore points predate managed greetings: they cannot restore an unknown greeting.
    const fields = ownedFields.filter(k => !['first_message', 'tts'].includes(k) || Object.hasOwn(settings, k));
    // The old prompt's variables still exist in the merged catalog until this restore.
    const current = Object.fromEntries(fields.filter(k => Object.hasOwn(originals[index]!, k)).map(k => [k, originals[index]![k]])); index++;
    await api.request('PATCH', `/v1/agents/${id}`, restorePatch(settings, current));
    await api.request('PUT', `/v1/agents/${id}/variables`, { variables });
    if(toolBackup){
      await api.request('PATCH',`/v1/agents/${id}/tools/${toolBackup.id}`,{description:toolBackup.description});
    }
    const agent = await api.agent(id); const catalog = await api.variables(id);
    const restored = Object.fromEntries(fields.filter(k => Object.hasOwn(agent, k)).map(k => [k, agent[k]]));
    if (!restoredFieldsMatch(restored, settings) || catalog.length !== variables.length || variables.some(v => !catalog.some(a => fieldsMatch(a, v)))) throw new Error('Speechify restore was not verified.');
    if(toolBackup&&endCall(agent)?.['description']!==toolBackup.description)throw new Error('The end-call restore was not verified.');
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
