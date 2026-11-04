import {weeklyToolsAllowed} from './runtime.ts';

export const DIALOGUE_POLICY='confirmed-actions-v1';
export const dialogueAgentKeys={first:'SPEECHIFY_DIALOGUE_FIRST_CALL_AGENT_ID',return:'SPEECHIFY_DIALOGUE_AGENT_ID',
  'female-first':'SPEECHIFY_DIALOGUE_FEMALE_FIRST_CALL_AGENT_ID','female-return':'SPEECHIFY_DIALOGUE_FEMALE_AGENT_ID'} as const;
export function dialoguePilotAllowed(hash:string,env:NodeJS.ProcessEnv=process.env):boolean {
  return (env['WEEKLY_DIALOGUE_READY']==='1'||env['WEEKLY_DIALOGUE_PILOT']==='1'&&hash===env['WEEKLY_TOOLS_PILOT_HASH'])&&weeklyToolsAllowed(hash,env);
}
/** Only trusted server context can select these private, unassigned agents. */
export function dialogueAgent(context:string|undefined,first:boolean,female:boolean,env:NodeJS.ProcessEnv=process.env):string|undefined {
  if((env['WEEKLY_DIALOGUE_PILOT']!=='1'&&env['WEEKLY_DIALOGUE_READY']!=='1')||!context)return undefined;
  let value:unknown;try{value=JSON.parse(context);}catch{return undefined;}
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const data=value as {available?:unknown;dialogue_policy?:unknown};
  if(data.available!==true||data.dialogue_policy!==DIALOGUE_POLICY)return undefined;
  const ids=Object.values(dialogueAgentKeys).map(key=>env[key]);
  const live=['SPEECHIFY_FIRST_CALL_AGENT_ID','SPEECHIFY_AGENT_ID','SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID','SPEECHIFY_FEMALE_AGENT_ID'].map(key=>env[key]);
  if(ids.some(id=>!id||!/^[a-zA-Z0-9_-]{1,120}$/.test(id)||live.includes(id))||new Set(ids).size!==4)throw new Error('Four distinct private dialogue pilot agents must be verified before calling.');
  const role=female?(first?'female-first':'female-return'):(first?'first':'return');
  return env[dialogueAgentKeys[role]];
}
