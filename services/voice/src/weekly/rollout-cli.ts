import { readFileSync, writeFileSync, renameSync, lstatSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'dotenv';
import { config, repoRoot } from '../config.ts';
import { promptPack } from '../agent/prompt-pack.ts';
import { resourceId, SpeechifySettingsApi } from '../agent/speechify-sync.ts';
import { dialogueAgentKeys } from './dialogue-policy.ts';
import { dialogueFlagSource, ROLLOUT_PIPELINE_FILES, rolloutTextHash, verifyDialogueRollout } from './rollout.ts';

let lock: string | undefined;
async function readFlow(key: string, id: string, suffix: '/flow' | '/flow/versions'): Promise<unknown> {
  const response=await fetch(`https://api.speechify.ai/v1/agents/${resourceId(id)}${suffix}`,{headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(20_000)});
  if(!response.ok)throw new Error('Provider flow could not be verified.');
  return response.json();
}
try{
  const mode=process.argv[2], approvalFile=process.argv[3];
  if(!['--check','--activate','--disable'].includes(mode??'')||(mode==='--disable'?process.argv.length!==3:!approvalFile||process.argv.length!==4))throw new Error('Invalid command.');
  const path=resolve(repoRoot,'.env'), source=readFileSync(path,'utf8');
  if(mode!=='--check'){
    if(lstatSync(path).isSymbolicLink())throw new Error('Configuration symlink cannot be changed.');
    const candidate=resolve(repoRoot,'.weekly-dialogue-rollout.lock');closeSync(openSync(candidate,'wx',0o600));lock=candidate;
  }
  if(mode!=='--disable'){
    const file=lstatSync(approvalFile!);if(!file.isFile()||file.isSymbolicLink()||file.size>500_000||(file.mode&0o077)!==0)throw new Error('Approval must be a private regular file.');
    const approval:unknown=JSON.parse(readFileSync(approvalFile!,'utf8'));
    if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim())throw new Error('Release has tracked changes.');
    const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    const env={...process.env,...parse(source)};
    if(env['WEEKLY_TOOLS_READY']!=='0')throw new Error('Feature tools must remain disabled.');
    const specs=[...promptPack('weekly',{}),...promptPack('weekly-female',{})],api=new SpeechifySettingsApi(config.speechify.apiKey());
    const agents:Record<string,Record<string,unknown>>={};
    for(const spec of specs){
      const id=env[dialogueAgentKeys[spec.role as keyof typeof dialogueAgentKeys]]??'';
      agents[spec.role]={...await api.agent(id),verified_variables:await api.variables(id),verified_flow:{current:await readFlow(config.speechify.apiKey(),id,'/flow'),versions:await readFlow(config.speechify.apiKey(),id,'/flow/versions')}};
    }
    const pipeline=Object.fromEntries(ROLLOUT_PIPELINE_FILES.map(name=>[name,rolloutTextHash(readFileSync(resolve(repoRoot,'services/voice/src',name),'utf8'))]));
    const checked=verifyDialogueRollout(approval,revision,specs,agents,env,pipeline);
    if(mode==='--check')process.stdout.write(JSON.stringify({...checked,configurationChanged:false})+'\n');
  }
  if(mode!=='--check'){
    if(readFileSync(path,'utf8')!==source)throw new Error('Configuration changed during verification.');
    const next=dialogueFlagSource(source,mode==='--activate');
    if(next!==source){
      writeFileSync(resolve(repoRoot,`.env.weekly-dialogue-backup-${Date.now()}-${randomUUID()}`),source,{mode:0o600,flag:'wx'});
      const temp=path+'.weekly-'+randomUUID();writeFileSync(temp,next,{mode:0o600,flag:'wx'});renameSync(temp,path);
    }
    process.stdout.write(JSON.stringify({dialogueEnabled:mode==='--activate',onlyDialogueFlagChanged:true,restartRequired:true,phoneCallsPlaced:0,messagesSent:0})+'\n');
  }
}catch{
  process.stderr.write('Weekly dialogue rollout stopped. Check the private approval, source and settings. No private values were printed.\n');process.exitCode=1;
}finally{if(lock)unlinkSync(lock);}
