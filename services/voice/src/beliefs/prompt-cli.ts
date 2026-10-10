import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const kind=process.argv[2];
if(!['onboarding','daily','weekly'].includes(kind??'')){console.error('Use: npm run beliefs:prompt -- onboarding|daily|weekly');process.exitCode=1;}
else console.log(readFileSync(resolve(import.meta.dirname,'../../../../docs/beliefs/'+kind+'-script.md'),'utf8'));
