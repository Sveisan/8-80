import { execFileSync } from 'node:child_process';
import { config, repoRoot } from '../config.ts';
import { SpeechifyFlowApi } from '../agent/weekly-flow-sync.ts';
import { verifyWeeklyRelease } from './release.ts';

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--check', '--if-enabled'].includes(args[0]!)) throw Error('Use --check or --if-enabled.');
  const enabled = process.env['WEEKLY_DIALOGUE_READY'] === '1' || process.env['WEEKLY_DIALOGUE_PILOT'] === '1';
  if (!enabled && args[0] === '--if-enabled') console.log(JSON.stringify({ required: false, configurationChanged: false, providerWrites: 0 }));
  else {
    const result = await verifyWeeklyRelease(new SpeechifyFlowApi(config.speechify.apiKey()), process.env);
    const release = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    console.log(JSON.stringify({ ...result, release }));
  }
} catch {
  console.error('Weekly release verification stopped. Inspect private source/settings. Routing flags and provider configuration were not changed.');
  process.exitCode = 1;
}
