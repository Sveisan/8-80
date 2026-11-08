import { mkdirSync, existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, repoRoot } from '../config.ts';
import { parseState, resourceId } from '../agent/speechify-sync.ts';
import { ToolSetupError, provisionUnblockTools, resolveAgentIds, type UnblockToolMode } from './tools-core.ts';

const usage = 'Use: npm run unblock:tools -- --check|--prepare|--enable|--disable --tool-id TOOL_ID';
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = args.find(v => ['--check', '--prepare', '--enable', '--disable'].includes(v));
  const at = args.indexOf('--tool-id');
  if (!flag || at < 0 || !args[at + 1]) throw new ToolSetupError(usage);
  const mode = flag.slice(2) as UnblockToolMode; const toolId = resourceId(args[at + 1]);
  let stateIds: Record<string, string> = {};
  try { stateIds = parseState(JSON.parse(readFileSync(resolve(repoRoot, '.speechify-sync', 'state.json'), 'utf8'))).ids; } catch { /* env ids are enough */ }
  const agents = resolveAgentIds(process.env, stateIds);
  const key = config.speechify.apiKey();
  const dir = resolve(repoRoot, '.speechify-sync', 'unblock-tools'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  await provisionUnblockTools({ mode, toolId, agents, publicUrl: config.link.publicUrl() }, {
    request: async (method, path, body) => {
      const response = await fetch(`https://api.speechify.ai${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      if (!response.ok) throw new Error(`Speechify tool operation ${method} failed (${response.status}); no response content printed.`);
      return text ? JSON.parse(text) as Record<string, unknown> : {};
    },
    write: (name, content) => writeFileSync(resolve(dir, name), content, { mode: 0o600, flag: 'wx' }),
    exists: name => existsSync(resolve(dir, name)),
    remove: name => unlinkSync(resolve(dir, name)),
    now: Date.now,
    log: line => console.log(line),
  });
  if (mode === 'enable') console.log('Tool attached and enabled on all three agents. Real-call verification and the UNBLOCK_ flags remain separate steps.');
}
void main().catch(error => {
  console.error(error instanceof ToolSetupError ? error.message : 'Unblock tool setup did not complete. Check private backups and provider state; UNBLOCK_ENABLED must remain off.');
  process.exitCode = 1;
});
