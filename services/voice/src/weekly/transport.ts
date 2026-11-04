import { WeeklyToolError } from './reminders.ts';

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
  return v['arguments'];
}
