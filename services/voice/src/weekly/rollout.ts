import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { dialogueAgent, dialogueAgentKeys, dialoguePilotAllowed } from './dialogue-policy.ts';
import { weeklyToolsAllowed } from './runtime.ts';
import type { PromptSpec } from '../agent/prompt-pack.ts';

type Json = Record<string, unknown>;
const object = (v: unknown): Json => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const need = (v: unknown) => { if (!v) throw new Error('Weekly dialogue approval did not match the release.'); };
const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])) : v;
export const rolloutHash = (v: unknown): string => createHash('sha256').update(JSON.stringify(stable(v ?? null))).digest('hex');
export const rolloutTextHash = (v: string): string => createHash('sha256').update(v).digest('hex');
/** Pin effective provider settings, including turn-taking, STT and duration.
 * Prompt/greeting/variables/flow are checked separately; timestamps are metadata. */
export const rolloutProviderHash = (agent: Json): string => rolloutHash(Object.fromEntries(Object.entries(agent).filter(([key])=>!['id','prompt','first_message','created_at','updated_at','verified_variables','verified_flow'].includes(key))));
export const ROLLOUT_PIPELINE_FILES = [
  'call/outcome.ts','call/weekly-lines.ts','call/readback.ts','call/lastweek.ts','call/reschedule.ts',
  'loop/settle.ts','store/postgres.ts','messages/outbox.ts','recap/compose.ts','recap/resend.ts',
  'webhook/speechify.ts','webhook/signature.ts',
  'weekly/dialogue-policy.ts','weekly/runtime.ts','loop/tick.ts','agent/speechify.ts',
] as const;

/** Approved owner pilot + live aftercare evidence, bound to source and exact
 * provider settings. This performs no provider writes or customer actions. */
export function verifyDialogueRollout(approval: unknown, release: string, specs: PromptSpec[], agents: Record<string, Json>, env: NodeJS.ProcessEnv, pipeline: Record<string,string>, now = new Date()) {
  const a=object(approval), native=object(a['native']), pilot=object(a['ownerPilot']), aftercare=object(a['aftercare']), roles=object(a['roles']), files=object(a['pipeline']);
  need(a['version']===1 && /^[a-f0-9]{40}$/.test(release) && a['releaseCommit']===release && /^[a-f0-9]{40}$/.test(String(a['testedPromptCommit'])));
  const approvedAt=typeof a['approvedAt']==='string'?Date.parse(a['approvedAt']):NaN;
  need(Number.isFinite(approvedAt)&&+now>=approvedAt&&+now-approvedAt<=48*3600_000);
  need(native['sourceCommit']===a['testedPromptCommit']&&native['total']===120&&native['passed']===120&&native['approvedForPhonePilot']===true);
  need(pilot['sourceCommit']===a['testedPromptCommit']&&pilot['firstMemoryVerified']===true&&pilot['returnMemoryMatched']===true&&pilot['storedActionSpoken']===true&&pilot['bothGoodbyesNatural']===true);
  const memory=object(aftercare['memoryMatches']);
  need(aftercare['verified']===true&&aftercare['automaticHttpSettlement']===true&&aftercare['deliveryStatus']==='delivered'&&aftercare['counterIncrement']===1&&aftercare['recapIntentCount']===1&&aftercare['recapProviderReceiptCount']===1&&aftercare['recapTransportAttempts']===1&&aftercare['duplicateWebhooksCompleted']===true&&aftercare['normalOwnerUnchanged']===true&&['commitment','eight','eighty','goals'].every(key=>memory[key]===true));
  for(const path of ROLLOUT_PIPELINE_FILES)need(/^[a-f0-9]{64}$/.test(String(files[path]))&&files[path]===pipeline[path]);
  need(env['WEEKLY_TOOLS_READY']==='0'&&env['SPEECHIFY_SEND_VARIABLES']==='1');
  const future={...env,WEEKLY_DIALOGUE_READY:'1'}, ordinaryHash=env['WEEKLY_TOOLS_PILOT_HASH']==='a'.repeat(64)?'b'.repeat(64):'a'.repeat(64);
  need(dialoguePilotAllowed(ordinaryHash,future)&&!weeklyToolsAllowed(ordinaryHash,future));
  need(specs.length===4&&new Set(specs.map(s=>s.role)).size===4);
  for(const spec of specs){
    need(Object.hasOwn(dialogueAgentKeys,spec.role));const role=spec.role as keyof typeof dialogueAgentKeys;
    const proof=object(roles[role]), agent=object(agents[role]), tools=agent['tools'];
    need(proof['id']===env[dialogueAgentKeys[role]]&&agent['id']===proof['id']);
    need(proof['prompt']===rolloutTextHash(spec.prompt)&&agent['prompt']===spec.prompt&&agent['first_message']===spec.firstMessage&&proof['greeting']===rolloutHash(agent['first_message']));
    need(proof['llm']===rolloutHash(agent['llm'])&&proof['tts']===rolloutHash(agent['tts'])&&proof['tools']===rolloutHash(tools)&&proof['amd']===rolloutHash(agent['amd'])&&proof['memory']===rolloutHash(agent['memory']));
    need(proof['providerSettings']===rolloutProviderHash(agent));
    const flow=object(agent['verified_flow']), current=flow['current'], versions=object(flow['versions']);
    need(current!==null&&typeof current==='object'&&!Array.isArray(current)&&Object.keys(current).length===0&&Array.isArray(versions['versions'])&&versions['versions'].length===0&&versions['has_more']===false&&versions['next_cursor']===null&&proof['flow']===rolloutHash(flow));
    const variables=agent['verified_variables'];
    need(Array.isArray(variables)&&variables.length===spec.variables.length&&spec.variables.every(key=>variables.filter(v=>object(v)['key']===key&&object(v)['type']==='string').length===1)&&proof['variables']===rolloutHash(variables));
    need(agent['is_public']===false&&object(agent['memory'])['enabled']===false&&agent['save_audio_recording']===false);
    const amd=object(agent['amd']);need(amd['enabled']===true&&object(amd['on_voicemail'])['action']==='hangup');
    need(Array.isArray(tools)&&['end_call','skip_turn'].every(name=>tools.some(t=>{const tool=object(t);return tool['name']===name&&tool['kind']==='builtin'&&tool['enabled']!==false&&object(tool['config'])['builtin']===name;})));
    const context=JSON.stringify({available:false,dialogue_policy:'confirmed-actions-v1'});
    need(dialogueAgent(context,role.endsWith('first'),role.startsWith('female'),future)===proof['id']);
  }
  return {ready:true,roles:4,featureToolsEnabled:false,sourceVerified:true,ownerPilotVerified:true,automaticAftercareVerified:true};
}

/** Change one flag, preserving all other configuration byte-for-byte. */
export function dialogueFlagSource(source: string, enabled: boolean): string {
  const before=parse(source), pattern=/^(?:[\t ]*export[\t ]+)?[\t ]*WEEKLY_DIALOGUE_READY[\t ]*=.*$/gm;
  if((source.match(pattern)??[]).length>1 || before['WEEKLY_DIALOGUE_READY']!==undefined&&!['0','1'].includes(before['WEEKLY_DIALOGUE_READY']))throw new Error('Ambiguous dialogue flag.');
  const line=`WEEKLY_DIALOGUE_READY=${enabled?'1':'0'}`;
  const next=pattern.test(source)?source.replace(pattern,line):source+(source.endsWith('\n')?'':'\n')+line+'\n';
  const after=parse(next);delete before['WEEKLY_DIALOGUE_READY'];delete after['WEEKLY_DIALOGUE_READY'];
  if(rolloutHash(before)!==rolloutHash(after))throw new Error('Other configuration changed.');
  return next;
}
