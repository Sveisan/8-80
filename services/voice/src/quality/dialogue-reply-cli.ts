import { readFileSync } from 'node:fs';
import { dialogueBatchReport } from './dialogue-reply.ts';

const path = process.argv[2];
if (!path) throw new Error('Usage: node --import tsx services/voice/src/quality/dialogue-reply-cli.ts result.json');
const text = readFileSync(path, 'utf8');
if (text.length > 2_000_000) throw new Error('Dialogue result limit exceeded.');
const report = dialogueBatchReport(JSON.parse(text));
process.stdout.write(JSON.stringify(report) + '\n');
if (!report.approved) process.exitCode = 1;
