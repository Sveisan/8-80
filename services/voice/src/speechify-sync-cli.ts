import { mkdir, readFile, writeFile, rename, open, unlink, chmod, lstat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { repoRoot } from './config.ts';
import { promptPack, agentKeys, type AgentGroup, type AgentRole } from './agent/prompt-pack.ts';
import { SpeechifySettingsApi, syncAgents, parseState, promptDigest, mergeAgentIds, restoreAgents, type SyncState } from './agent/speechify-sync.ts';

const args = process.argv.slice(2);
const usage = 'Use: npm run speechify:sync -- [--group weekly|beliefs|all] [--check | --apply [--write-ids] | --restore BACKUP_FILENAME]';
type Mode = 'plan' | 'check' | 'apply' | 'restore';
async function main(): Promise<void> {
  let group: AgentGroup = 'weekly'; let mode: Mode = 'plan'; let writeIds = false; let backupName = '';
  const modes: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--group') { const value = args[++i]; if (!['weekly', 'beliefs', 'all'].includes(value ?? '')) throw new Error(usage); group = value as AgentGroup; }
    else if (arg === '--apply' || arg === '--check' || arg === '--restore') { modes.push(arg); mode = arg.slice(2) as Mode; if (mode === 'restore') backupName = args[++i] ?? ''; }
    else if (arg === '--write-ids') writeIds = true;
    else throw new Error(usage);
  }
  if (modes.length > 1 || (writeIds && mode !== 'apply') || (mode === 'restore' && (!/^backup-[a-zA-Z0-9-]+\.json$/.test(backupName) || basename(backupName) !== backupName))) throw new Error(usage);
  const specs = promptPack(group);
  if (mode === 'plan') {
    console.log('Speechify source plan — no network requests or changes.');
    for (const spec of specs) console.log(`${spec.role}: ${spec.variables.length} required variables; prompt ${promptDigest(spec.prompt)}; ${process.env[agentKeys[spec.role]] ? 'existing agent configured' : 'create if absent from saved state'}.`);
    console.log('Run --check to compare with Speechify, or --apply to upload. Add --write-ids to save verified routing IDs in .env.');
    console.log('Tools, phone assignments and live-call readiness are separate from prompt upload.');
    return;
  }
  const api = new SpeechifySettingsApi(process.env['SPEECHIFY_API_KEY'] ?? '');
  const dir = resolve(repoRoot, '.speechify-sync');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('Speechify sync directory must not be a symbolic link.');
  await chmod(dir, 0o700);
  const lockPath = resolve(dir, 'lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { throw new Error('Another Speechify sync is running, or its lock remains after interruption. Check the process before removing .speechify-sync/lock.'); }
  const privateWrite = async (path: string, value: string): Promise<void> => {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, value, { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
  };
  try {
    await lock.writeFile(String(process.pid));
    if (mode === 'restore') {
      let backup: unknown;
      try { backup = JSON.parse(await readFile(resolve(dir, backupName), 'utf8')); } catch { throw new Error('The private restore point is unreadable. No contents were printed.'); }
      const count = await restoreAgents(api, backup);
      console.log(`Restored and checked ${count} agent configurations. No agents were deleted; routing IDs and phone assignments were unchanged.`);
      return;
    }
    let state: SyncState = { version: 1, ids: {} };
    try { state = parseState(JSON.parse(await readFile(resolve(dir, 'state.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Saved Speechify state is unreadable. Restore it before continuing.'); }
    let lastBackup = '';
    const reports = await syncAgents(api, { specs, env: process.env, state, apply: mode === 'apply',
      saveState: async value => privateWrite(resolve(dir, 'state.json'), JSON.stringify(value, null, 2)),
      saveBackup: async value => { lastBackup = `backup-${Date.now()}-${randomUUID()}.json`; await privateWrite(resolve(dir, lastBackup), JSON.stringify(value, null, 2)); console.log(`Private restore point: ${lastBackup} (inside .speechify-sync; do not paste its contents).`); },
    });
    for (const report of reports) console.log(`${report.role}: ${mode === 'apply' ? 'uploaded and read back' : report.created ? 'needs creation' : report.changed ? 'update needed' : 'matches source'}; required tools ${report.tools === 'present' ? 'listed (call test still required)' : 'not verified'}.`);
    if (mode === 'apply' && writeIds) {
      if (reports.some(r => process.env[agentKeys[r.role]]?.trim() !== r.id && r.tools !== 'present')) throw new Error('New routing IDs were not saved: required tools are not verified. Agent IDs remain in the private setup state for the next run.');
      const path = resolve(repoRoot, '.env'); const source = await readFile(path, 'utf8');
      const verified = Object.fromEntries(reports.map(r => [r.role, r.id])) as Partial<Record<AgentRole, string>>;
      const updated = mergeAgentIds(source, verified);
      if (updated !== source) { await privateWrite(resolve(dir, `env-backup-${Date.now()}.txt`), source); await privateWrite(path, updated); }
      console.log('Verified agent IDs saved in .env. Credentials, launch flags and caller settings were not changed.');
    }
    console.log('No calls, messages, purchases, phone reassignments or tool changes were made.');
    if (group !== 'weekly') console.log('Beliefs capture-tool setup and real-call verification remain required. No BELIEFS_ approval flag was enabled.');
    if (mode === 'check' && reports.some(r => r.changed)) process.exitCode = 2;
  } finally { await lock.close(); await unlink(lockPath); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Speechify sync failed; no raw details were printed.'); process.exitCode = 1; });
