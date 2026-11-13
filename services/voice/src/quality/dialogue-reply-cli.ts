import { readFileSync, statSync } from 'node:fs';
import { dialogueBatchReport } from './dialogue-reply.ts';

try {
  const path = process.argv[2];
  const phonePilot = process.argv[3] === '--for-phone-pilot';
  if (!path || process.argv.length !== (phonePilot ? 4 : 3) || statSync(path).size > 2_000_000) throw new Error('Invalid review source.');
  const report = dialogueBatchReport(JSON.parse(readFileSync(path, 'utf8')));
  process.stdout.write(JSON.stringify(report) + '\n');
  if (!(phonePilot ? report.approvedForPhonePilot : report.approved)) process.exitCode = 1;
} catch {
  // Parser and filesystem errors may quote private input, paths or credentials.
  process.stderr.write('Dialogue review could not be completed. Check the private input file. No raw content was printed.\n');
  process.exitCode = 1;
}
