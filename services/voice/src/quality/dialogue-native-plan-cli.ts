import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { repoRoot } from '../config.ts';
import { nativeDialoguePlan } from './dialogue-native-plan.ts';

try {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error('Choose a private output file.');
  const status=execFileSync('git',['status','--porcelain'],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(status)throw new Error('Commit source changes before exporting.');
  const source = execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  writeFileSync(path,JSON.stringify(nativeDialoguePlan(source),null,2),{mode:0o600,flag:'wx'});
  process.stdout.write('Fictional four-role dialogue plan created privately. No provider requests or phone calls were made.\n');
} catch {
  process.stderr.write('Dialogue plan was not written. Check the source revision and choose a new private output file. No private input was printed.\n');
  process.exitCode=1;
}
