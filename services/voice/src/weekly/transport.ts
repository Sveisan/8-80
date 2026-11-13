import { WeeklyToolError } from './reminders.ts';

/** Speechify can populate every optional schema field with an empty default.
 * Remove only those defaults, never a meaningful competing time or consent. */
export function weeklySpeechifyDefaults(input:Record<string,unknown>):Record<string,unknown> {
  const out={...input};let changed=false;
  const drop=(key:string)=>{if(Object.hasOwn(out,key)){delete out[key];changed=true;}};
  for(const key of ['text','date','time','draft_id','tip_id','response'])if(out[key]===''||out[key]===null)drop(key);
  for(const key of ['after_minutes','shift_minutes'])if(out[key]===null)drop(key);
  const command=out['command'];
  if(command!=='reminder_confirm'&&(out['confirmed']===false||out['confirmed']===null))drop('confirmed');
  if(command==='reminder_prepare'){
    const absolute=Object.hasOwn(out,'date')||Object.hasOwn(out,'time');
    const after=typeof out['after_minutes']==='number'&&out['after_minutes']!==0;
    const shift=typeof out['shift_minutes']==='number'&&out['shift_minutes']!==0;
    if(out['shift_minutes']===0&&(after||absolute))drop('shift_minutes');
    if(out['after_minutes']===0&&(shift||absolute))drop('after_minutes');
    if(!Object.hasOwn(out,'shift_minutes')&&(out['revision']===0||out['revision']===null))drop('revision');
  }else{
    for(const key of ['after_minutes','shift_minutes'])if(out[key]===0)drop(key);
    if(command!=='reminder_cancel'&&(out['revision']===0||out['revision']===null))drop('revision');
  }
  return changed?out:input;
}

/** Speechify's webhook worker wraps the model arguments; direct API callers do not. */
export function weeklyWebhookArguments(input:unknown):unknown {
  if(!input||typeof input!=='object'||Array.isArray(input))return input;
  const v=input as Record<string,unknown>;
  if(!Object.hasOwn(v,'arguments'))return input;
  if(v['tool_name']!=='weekly_assist'||typeof v['tool_call_id']!=='string'||!v['tool_call_id']
    ||typeof v['timestamp']!=='number'||!Number.isFinite(v['timestamp'])
    ||!v['arguments']||typeof v['arguments']!=='object'||Array.isArray(v['arguments'])
    ||['attempt_id','session_token','command','request_id'].some(k=>Object.hasOwn(v,k)))throw new WeeklyToolError('unauthorized');
  // The normal per-attempt HMAC, caller scope, expiry and idempotency checks
  // still apply to the unwrapped arguments. Envelope metadata grants nothing.
  return weeklySpeechifyDefaults(v['arguments'] as Record<string,unknown>);
}
