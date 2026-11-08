import { resourceId } from '../agent/speechify-sync.ts';

export const UNBLOCK_TOOL_NAME = 'capture_unblock';
export const UNBLOCK_TOOL_PATH = '/unblock/tool';
export const UNBLOCK_AGENT_KEYS = ['UNBLOCK_OPENING_AGENT_ID', 'UNBLOCK_WEEKLY_AGENT_ID', 'UNBLOCK_LIGHT_AGENT_ID'] as const;
export const UNBLOCK_AGENT_ROLES = ['unblock-opening', 'unblock-weekly', 'unblock-light'] as const;
export type UnblockToolMode = 'check' | 'prepare' | 'enable' | 'disable';

export interface ToolParam { name: string; type: 'string' | 'boolean' | 'integer'; required: boolean }
// TODO(conductor): this list must match UNBLOCK_TOOL_PARAMS in src/unblock/protocol.ts once the backend lands.
export const UNBLOCK_TOOL_PARAMS: readonly ToolParam[] = [
  { name: 'session_id', type: 'string', required: true },
  { name: 'session_token', type: 'string', required: true },
  { name: 'event_id', type: 'string', required: true },
  { name: 'caller_text', type: 'string', required: true },
  { name: 'command', type: 'string', required: false },
  { name: 'confirmed', type: 'boolean', required: false },
  { name: 'text', type: 'string', required: false },
  { name: 'why_text', type: 'string', required: false },
  { name: 'kind', type: 'string', required: false },
  { name: 'outcome', type: 'string', required: false },
  { name: 'outcome_text', type: 'string', required: false },
  { name: 'carry_text', type: 'string', required: false },
  { name: 'days', type: 'string', required: false },
  { name: 'time', type: 'string', required: false },
  { name: 'week', type: 'integer', required: false },
];

/** A message that is safe to print: it never contains provider content. */
export class ToolSetupError extends Error {}

export interface Binding { id: string; name: string; enabled: boolean; kind: string; definition_id?: string; config?: { url?: string; method?: string; params?: { name: string; type: string; required: boolean }[] } }
type Json = Record<string, unknown>;

export function unblockToolUrl(publicUrl: string): string {
  let url: URL;
  try { url = new URL(UNBLOCK_TOOL_PATH, publicUrl); } catch { throw new ToolSetupError('PUBLIC_URL is not a valid URL.'); }
  if (url.protocol !== 'https:') throw new ToolSetupError('PUBLIC_URL must be https for the Unblock tool.');
  return url.href;
}

/** Exact, order-insensitive match against the pinned parameter list. */
export function paramsMatch(params: unknown): boolean {
  if (!Array.isArray(params) || params.length !== UNBLOCK_TOOL_PARAMS.length) return false;
  return UNBLOCK_TOOL_PARAMS.every(want => params.filter(p => p && typeof p === 'object' && (p as Json)['name'] === want.name).length === 1
    && params.some(p => p && (p as Json)['name'] === want.name && (p as Json)['type'] === want.type && (p as Json)['required'] === want.required));
}

/** Throws ToolSetupError unless the owner-created definition is exactly the reviewed contract. */
export function verifyToolDefinition(definition: Json, publicUrl: string): void {
  const url = unblockToolUrl(publicUrl);
  const config = definition['config'] && typeof definition['config'] === 'object' ? definition['config'] as Json : {};
  if (definition['name'] !== UNBLOCK_TOOL_NAME) throw new ToolSetupError(`Tool definition name must be ${UNBLOCK_TOOL_NAME}.`);
  if (definition['kind'] !== 'webhook') throw new ToolSetupError('Tool definition kind must be webhook.');
  if (config['method'] !== 'POST') throw new ToolSetupError('Tool definition method must be POST.');
  if (config['url'] !== url) throw new ToolSetupError(`Tool definition URL must be exactly ${url}.`);
  if (!paramsMatch(config['params'])) throw new ToolSetupError('Tool definition parameters do not match the reviewed list (names, types and required flags).');
}

export type AgentIds = { key: (typeof UNBLOCK_AGENT_KEYS)[number]; id: string }[];
/** Environment first, then the sync's private state ids. All three must exist and differ. */
export function resolveAgentIds(env: NodeJS.ProcessEnv, stateIds: Partial<Record<string, string>> = {}): AgentIds {
  const ids = UNBLOCK_AGENT_KEYS.map((key, i) => {
    const value = env[key]?.trim() || stateIds[UNBLOCK_AGENT_ROLES[i]!];
    if (!value) throw new ToolSetupError(`${key} is not configured. Run the Unblock sync (--apply) first.`);
    return { key, id: resourceId(value) };
  });
  if (new Set(ids.map(v => v.id)).size !== ids.length) throw new ToolSetupError('Three distinct Unblock agents must be configured.');
  return ids;
}

/** A binding is "ours" when it is the attached definition with the reviewed endpoint and parameters. */
export function bindingMatches(binding: Binding | undefined, toolId: string, publicUrl: string): boolean {
  return !!binding && binding.id === toolId && binding.name === UNBLOCK_TOOL_NAME && binding.kind === 'webhook'
    && binding.config?.url === unblockToolUrl(publicUrl) && binding.config.method === 'POST' && paramsMatch(binding.config.params);
}

/** Read-back after any mode: our binding in the intended state, end_call still enabled, nothing else disturbed. */
export function readBackOk(original: Binding[], current: Binding[], toolId: string, publicUrl: string, mode: UnblockToolMode): boolean {
  const ours = current.find(b => b.id === toolId);
  if (!bindingMatches(ours, toolId, publicUrl)) return false;
  if (mode !== 'check' && ours!.enabled !== (mode === 'enable')) return false;
  if (!current.some(b => b.name === 'end_call' && b.enabled)) return false;
  return original.every(b => b.id === toolId || current.some(a => a.id === b.id && a.enabled === b.enabled));
}

export interface ToolIo {
  request: (method: 'GET' | 'PUT' | 'PATCH', path: string, body?: unknown) => Promise<Json>;
  /** Exclusive private write; throws if the name exists. */
  write: (name: string, content: string) => void;
  exists: (name: string) => boolean;
  remove: (name: string) => void;
  now: () => number;
  log: (line: string) => void;
}

async function bindings(io: ToolIo, id: string): Promise<Binding[]> {
  const result = await io.request('GET', `/v1/agents/${id}/tools`);
  if (!Array.isArray(result['tools']) || result['has_more'] === true) throw new ToolSetupError('Complete bindings could not be verified.');
  return result['tools'] as Binding[];
}

export async function provisionUnblockTools(opts: { mode: UnblockToolMode; toolId: string; agents: AgentIds; publicUrl: string }, io: ToolIo): Promise<void> {
  const { mode, agents, publicUrl } = opts; const tool = resourceId(opts.toolId);
  const definition = await io.request('GET', `/v1/agents/tool-definitions/${tool}`);
  verifyToolDefinition(definition, publicUrl);
  const original: Record<string, Binding[]> = {};
  for (const { id } of agents) original[id] = await bindings(io, id);
  // Refuse before the first write if any agent already uses the name for a different tool.
  for (const { key, id } of agents) if (original[id]!.some(b => b.name === UNBLOCK_TOOL_NAME && b.id !== tool)) throw new ToolSetupError(`An unrelated binding already uses ${UNBLOCK_TOOL_NAME} on ${key}; no overwrite performed.`);
  if (mode !== 'check') io.write(`before-${io.now()}.json`, JSON.stringify({ definition, bindings: original }));
  for (const { key, id } of agents) {
    const prior = original[id]!.find(b => b.name === UNBLOCK_TOOL_NAME);
    const pending = `attach-${id}-${tool}.json`;
    if (!prior && mode === 'prepare') {
      if (io.exists(pending)) throw new ToolSetupError('An earlier attachment is unconfirmed. Check provider bindings before repeating.');
      io.write(pending, JSON.stringify({ id, tool }));
      // PUT attaches enabled, regardless of its body. The explicit PATCH below sets the intended state.
      await io.request('PUT', `/v1/agents/${id}/tools/${tool}`, {});
    }
    if (mode !== 'check') {
      if (!(await bindings(io, id)).find(b => b.id === tool)) throw new ToolSetupError('Prepare and verify the binding before changing its enabled state.');
      await io.request('PATCH', `/v1/agents/${id}/tools/${tool}`, { enabled: mode === 'enable' });
    } else if (!prior) throw new ToolSetupError(`${UNBLOCK_TOOL_NAME} is not attached to ${key}. Run --prepare.`);
    const current = await bindings(io, id);
    if (!readBackOk(original[id]!, current, tool, publicUrl, mode)) throw new ToolSetupError('Read-back did not verify the intended binding and existing tools.');
    if (io.exists(pending)) io.remove(pending);
    io.log(`${key}: ${UNBLOCK_TOOL_NAME} verified ${current.find(b => b.id === tool)!.enabled ? 'ENABLED' : 'DISABLED'}; existing tools preserved.`);
  }
}
