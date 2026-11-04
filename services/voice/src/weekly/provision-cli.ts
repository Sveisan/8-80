import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, repoRoot } from '../config.ts';
import { resourceId } from '../agent/speechify-sync.ts';

const args=process.argv.slice(2),mode=args.find(v=>['--check','--prepare','--enable','--disable'].includes(v));
const tool=resourceId(args[args.indexOf('--tool-id')+1]??'');
if(!mode || !args.includes('--tool-id'))throw new Error('Use --check|--prepare|--enable|--disable --tool-id TOOL_ID.');
const keys=['SPEECHIFY_FIRST_CALL_AGENT_ID','SPEECHIFY_AGENT_ID','SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID','SPEECHIFY_FEMALE_AGENT_ID'];
const ids=keys.map(key=>resourceId(process.env[key]??''));
if(new Set(ids).size!==4)throw new Error('Four distinct weekly agents must be configured.');
const base='https://api.speechify.ai',key=config.speechify.apiKey();
const dir=resolve(repoRoot,'.speechify-sync','weekly-tools');mkdirSync(dir,{recursive:true,mode:0o700});
const request=async(method:string,path:string,body?:unknown):Promise<Record<string,unknown>>=>{
  const response=await fetch(base+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${key}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text();
  if(!response.ok)throw new Error(`Speechify tool operation ${method} failed (${response.status}); no response content printed.`);
  return text?JSON.parse(text) as Record<string,unknown>:{};
};
const expected=['attempt_id','session_token','command','request_id','text','date','time','draft_id','tip_id','response','confirmed','revision'];
type Binding={id:string;name:string;enabled:boolean;kind:string;definition_id?:string;config?:{url?:string;method?:string;params?:{name:string;type:string;required:boolean}[]}};
const bindings=async(id:string):Promise<Binding[]>=>{
  const result=await request('GET',`/v1/agents/${id}/tools`);
  if(!Array.isArray(result['tools']) || result['has_more']===true)throw new Error('Complete bindings could not be verified.');
  return result['tools'] as Binding[];
};
try {
  const definition=await request('GET',`/v1/agents/tool-definitions/${tool}`);
  const c=definition['config'] as Binding['config'];
  const url=new URL('/weekly/tool',config.link.publicUrl());
  if(url.protocol!=='https:' || definition['name']!=='weekly_assist' || definition['kind']!=='webhook' || c?.url!==url.href || c.method!=='POST'
    || c.params?.length!==expected.length || expected.some(name=>!c.params?.some(p=>p.name===name && p.type===(name==='confirmed'?'boolean':name==='revision'?'integer':'string') && p.required===['attempt_id','session_token','command'].includes(name))))throw new Error('Tool definition does not match the reviewed endpoint and parameter contract.');
  const original:Record<string,Binding[]>={};for(const id of ids)original[id]=await bindings(id);
  const backup=resolve(dir,`before-${Date.now()}.json`);
  if(mode!=='--check')writeFileSync(backup,JSON.stringify({definition,bindings:original}),{mode:0o600,flag:'wx'});
  for(const [index,id] of ids.entries()){
    const prior=original[id]!.find(b=>b.name==='weekly_assist');
    if(prior && prior.id!==tool)throw new Error('An unrelated binding already uses weekly_assist; no overwrite performed.');
    if(!prior && mode==='--prepare'){
      // PUT attaches enabled, regardless of its body. Explicit PATCH sets the intended state.
      const pending=resolve(dir,`attach-${id}-${tool}.json`);
      if(existsSync(pending))throw new Error('An earlier attachment is unconfirmed. Check provider bindings before repeating.');
      writeFileSync(pending,JSON.stringify({id,tool}),{mode:0o600,flag:'wx'});
      await request('PUT',`/v1/agents/${id}/tools/${tool}`,{});
    }
    if(mode!=='--check'){
      const attached=(await bindings(id)).find(b=>b.id===tool);
      if(!attached)throw new Error('Prepare and verify the binding before changing its enabled state.');
      await request('PATCH',`/v1/agents/${id}/tools/${tool}`,{enabled:mode==='--enable'});
    }
    const current=await bindings(id),ours=current.find(b=>b.id===tool);
    if(!ours || ours.name!=='weekly_assist' || ours.kind!=='webhook' || ours.config?.url!==url.href || ours.config.params?.length!==12 || (mode!=='--check' && ours.enabled!==(mode==='--enable'))
      || !current.some(b=>b.name==='end_call' && b.enabled) || original[id]!.some(b=>b.id!==tool && !current.some(a=>a.id===b.id && a.enabled===b.enabled)))throw new Error('Read-back did not verify the intended binding and existing tools.');
    console.log(`${keys[index]}: weekly_assist verified ${ours.enabled?'ENABLED':'DISABLED'}; existing tools preserved.`);
  }
} catch {
  console.error('Weekly tool setup did not complete. Check private backups and provider state; global activation must remain off.');
  process.exitCode=1;
}
