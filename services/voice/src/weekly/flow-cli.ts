import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, repoRoot } from '../config.ts';
import { SpeechifyFlowApi, syncWeeklyFlows, type FlowMode, type FlowState } from '../agent/weekly-flow-sync.ts';
import { weeklyFlowRoles } from '../agent/weekly-flow.ts';
import { openDeps } from '../control.ts';

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2), mode = args[0] as FlowMode;
  if (!['check', 'stage', 'activate', 'deactivate'].includes(mode) || args.slice(1).some(v => v !== '--owner-pilot')) throw new Error('Use weekly:flow check|stage|activate|deactivate [--owner-pilot].');
  const dir = resolve(repoRoot, '.speechify-sync/weekly-flow');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lockPath = resolve(dir, 'operation.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('A flow operation is already active; inspect its status before retrying.'); });
  let deps: ReturnType<typeof openDeps> | undefined;
  try {
    const path = resolve(dir, 'state.json');
    let state: FlowState;
    try { state = JSON.parse(await readFile(path, 'utf8')) as FlowState; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Unreadable flow state.'); state = { version: 1 }; }
    if (state.version !== 1 || state.pending && (!weeklyFlowRoles.includes(state.pending.role) || !['activate', 'deactivate'].includes(state.pending.action))) throw new Error('Invalid flow state.');
    const atomic = async (p: string, value: unknown) => {
      const temporary = p + '.' + randomUUID();
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await rename(temporary, p);
    };
    const report = await syncWeeklyFlows(new SpeechifyFlowApi(config.speechify.apiKey()), {
      env: process.env, mode, ownerPilot: args.includes('--owner-pilot'), state,
      saveState: s => atomic(path, s),
      backup: b => writeFile(resolve(dir, 'backup-' + randomUUID() + '.json'), JSON.stringify(b), { mode: 0o600, flag: 'wx' }),
      assertIdle: async () => {
        deps ??= openDeps();
        const [row] = await deps.store.raw`select count(*)::int as n from call_attempts where status in ('claimed','placed','settling')`;
        if (row?.n !== 0) throw new Error('A call is in progress; wait before changing pilot flows.');
      },
    });
    console.log(JSON.stringify(report));
    if (mode === 'check' && report.roles.some(r => !r.activeMatches)) process.exitCode = 2;
  } finally {
    if (deps) await deps.store.close();
    await lock.close(); await unlink(lockPath);
  }
}
void main().catch(error => {
  console.error(error instanceof Error && /^(Use weekly:flow|A flow operation|Unreadable flow state|Invalid flow state|Four distinct private|Flow writes require|Private, memory-free|An unrelated flow|A call is in progress|An earlier flow|Weekly flow request|Published flow|Flow draft|The flow draft|Unknown flow-head|Complete pilot|The private weekly|The weekly variable|Unexpected tool|Unrecognised flow|Incomplete flow|Unexpected node|Unexpected edge|Unsupported weekly)/.test(error.message) ? error.message : 'Weekly flow operation stopped; inspect private state. No credentials or provider response were printed.');
  process.exitCode = 1;
});
