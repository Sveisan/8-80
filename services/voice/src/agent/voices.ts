/** Hosted agents have fixed voices. Each offered voice needs both conversation types. */
export function femaleAgents(env: NodeJS.ProcessEnv = process.env): { first: string; returning: string } | undefined {
  const first = env['SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID']?.trim();
  const returning = env['SPEECHIFY_FEMALE_AGENT_ID']?.trim();
  const ids = [first, returning, env['SPEECHIFY_FIRST_CALL_AGENT_ID']?.trim(), env['SPEECHIFY_AGENT_ID']?.trim()];
  if (!first || !returning || ![first, returning].every(id => /^[a-zA-Z0-9_-]{1,120}$/.test(id)) || first === returning || ids.slice(2).some(id => id === first || id === returning)) return undefined;
  return { first, returning };
}
export function femaleVoiceReady(env: NodeJS.ProcessEnv = process.env): boolean { return !!femaleAgents(env); }
/** Nudges are offered only when calls and SMS identify the same sender. */
export function sameMessageNumber(env: NodeJS.ProcessEnv = process.env): boolean {
  const clean = (v: string | undefined) => (v ?? '').replace(/[\s()-]/g, '');
  const sms = clean(env['SMS_FROM_NUMBER']);
  return /^\+[1-9]\d{6,14}$/.test(sms) && sms === clean(env['SPEECHIFY_CALLER_ID_NUMBER']);
}
