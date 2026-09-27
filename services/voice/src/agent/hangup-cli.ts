import { config } from '../config.ts';

/**
 * npx tsx services/voice/src/agent/hangup-cli.ts
 *
 * Gives both Speechify agents the built-in that ends a call, registered under
 * the name the prompt uses. Without it a call only ends when the caller hangs
 * up or the duration cap cuts it: one caller asked three times who would hang
 * up and was told "I can't discuss the call setup".
 *
 * The console has no place for it — system built-ins are added to an agent
 * through the API, not on the Tools page — so this is the way in. Safe to run
 * twice: an agent that already has it is reported and left alone.
 */
// The prompt names this exactly (prompt.ts, the close); change both together.
const HANG_UP_TOOL = 'hang_up';

const key = config.speechify.apiKey();
const base = config.speechify.base.replace(/\/+$/, '');
const agents = [...new Set([config.speechify.firstCallAgentId(), config.speechify.agentId()])];

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // Kept as text: an error page is still the most useful thing to print.
  }
  return { status: res.status, json };
}

const builtins = await call('GET', '/v1/agents/tools/system-builtins');
console.log(`system built-ins (HTTP ${builtins.status}):`, JSON.stringify(builtins.json));

for (const id of agents) {
  const tools = await call('GET', `/v1/agents/${encodeURIComponent(id)}/tools`);
  if (JSON.stringify(tools.json).includes(`"${HANG_UP_TOOL}"`)) {
    console.log(`${id}: already has ${HANG_UP_TOOL}`);
    continue;
  }
  const added = await call('POST', `/v1/agents/${encodeURIComponent(id)}/builtins`, { builtin: 'end_call', name: HANG_UP_TOOL });
  console.log(`${id}: add end_call as ${HANG_UP_TOOL} → HTTP ${added.status}`, JSON.stringify(added.json));
}
