import process from 'node:process';
import console from 'node:console';
import { appendFileSync } from 'node:fs';
import { clearPrivate, materialize, readRequest } from './contract.mjs';
try {
  const {result}=materialize(process.env.FEEDBACK_RESULT??'',process.argv.includes('--without-private-report')?{input:{}}:readRequest());
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`ready=${result.status==='ready'}\n`);
  console.log(result.status==='ready'?'Candidate patch passed scope and privacy checks.':'A person needs to clarify this report.');
}catch{console.error('Candidate patch was refused by the preparation policy.');process.exitCode=1;}
finally{clearPrivate();}
