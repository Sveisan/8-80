import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { openTestDb } from './helpers/db.ts';
import { loadScript } from '../src/script.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { SpeechifyAgent } from '../src/agent/speechify.ts';
import { tick, NOTHING_RECORDED } from '../src/loop/tick.ts';
import { settleConversation } from '../src/loop/settle.ts';
import { controlPlane } from '../src/control.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { readMemory, correctMemory } from '../src/memory/context.ts';
import { enqueue, dispatchMessage } from '../src/messages/outbox.ts';
import { buildInstructions } from '../src/prompt.ts';
import { weeklyPrompt } from '../src/agent/prompt-pack.ts';
import type { LoopDeps } from '../src/loop/deps.ts';
import { DIALOGUE_POLICY } from '../src/weekly/dialogue-policy.ts';
import { weeklyTool } from '../src/weekly/runtime.ts';

const opened = await openTestDb('weekly_memory_journey');
const db = typeof opened === 'string' ? undefined : opened;
const options = { skip: typeof opened === 'string' ? opened : false };
const script = loadScript();
const now = new Date('2026-10-06T06:00:00Z');
const nextWeek = new Date('2026-10-13T06:00:00Z');
const phoneA = '+4798200001';
const phoneB = '+4798200002';
const secret = 'synthetic-webhook-secret';
const nativeFetch = globalThis.fetch;
const wire: Array<Record<string, unknown>> = [];
const messages: unknown[] = [];
let providerReply: (() => Response) | undefined;
const fill = (key: string, values: Record<string, string> = {}) => script.get(key)!.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => values[key] ?? key);
const event = (id: string, lines: Array<['user' | 'assistant', string]>) => ({ event: 'conversation.completed', conversation_id: id, duration_ms: 600_000, status: 'completed', messages: lines.map(([role, content]) => ({ role, content })) });
const deps = (): LoopDeps => ({
  store: db!.store, scheduler: new Scheduler(db!.sql), script,
  agent: new SpeechifyAgent('synthetic-key', 'return-agent', 'first-agent', 'https://speechify.invalid', { variables: true, amd: false, language: false, ringingTimeout: false }),
  sms: { send: async (_to, body) => { messages.push(body); } },
  mailer: { send: async (_to, body) => { messages.push(body); } },
});

for(const reply of ['Thanks.','Right, thank you.','Yes, but not that action.'])test(`unconfirmed proposal cannot overwrite memory or appear in recap: ${reply}`,options,async()=>{
  Object.assign(process.env,{WEEKLY_DIALOGUE_PILOT:'1',WEEKLY_TOOLS_READY:'0',WEEKLY_TOOLS_PILOT_HASH:phoneKey(phoneA),WEEKLY_TOOL_SECRET:'synthetic-weekly-secret-with-32-characters',SPEECHIFY_SEND_VARIABLES:'1',
    SPEECHIFY_DIALOGUE_AGENT_ID:'pilot-return',SPEECHIFY_DIALOGUE_FIRST_CALL_AGENT_ID:'pilot-first',SPEECHIFY_DIALOGUE_FEMALE_AGENT_ID:'pilot-female-return',SPEECHIFY_DIALOGUE_FEMALE_FIRST_CALL_AGENT_ID:'pilot-female-first'});
  await enrol();await db!.store.record(phoneA,{at:now.toISOString(),durationMs:100_000,commitment:'original chosen action',onboardingComplete:true});
  const d=deps();await tick(d,now);
  await settleConversation(event('wire_1',[
    ['user','The product needs redesigning.'],['assistant',fill('next.confirm',{commitment:'redo the unchosen flyer'})],['user',reply],['assistant','Goodbye.'],
  ]),d,undefined,now);
  assert.equal((await db!.store.load(phoneA)).lastCommitment,'original chosen action');
  assert.doesNotMatch(JSON.stringify(messages),/redo the unchosen flyer/);
});
async function enrol(phone = phoneA) {
  await db!.store.upsertProfile(phone, { name: phone === phoneA ? 'Alpha Person' : 'Beta Person', email: `${phone === phoneA ? 'alpha' : 'beta'}@example.com` });
  await new Scheduler(db!.sql).setSlot(phone, { weekday: 2, minute: 480, timezone: 'Europe/Oslo' }, new Date(+now - 86400_000));
}
beforeEach(async () => {
  process.env['WEEKLY_DIALOGUE_PILOT']='0';delete process.env['WEEKLY_DIALOGUE_READY'];delete process.env['WEEKLY_TOOLS_PILOT_HASH'];
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 12).toString('base64');
  process.env['PUBLIC_URL'] = 'https://8and80.example';
  process.env['BELIEFS_ENABLED'] = '0';
  if (db) await db.sql`truncate belief_sessions,unblock_sessions, belief_refund_requests, belief_enrollments,unblock_enrollments, journey_events, journey_counts, message_attempts, message_outbox, callers, call_attempts, links, webhook_deliveries`;
  wire.length = messages.length = 0;
  providerReply = undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://speechify.invalid/v1/agents/outbound-calls') {
      wire.push(JSON.parse(String(init?.body)));
      return providerReply?.() ?? Response.json({ conversation_id: `wire_${wire.length}`, status: 'pending' });
    }
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    throw new Error('unexpected external request in local verification');
  };
});
after(async () => { globalThis.fetch = nativeFetch; await db?.close(); });

test('global dialogue-only calls route both voices and settle signed callbacks strictly without feature authority',options,async t=>{
  const values:NodeJS.ProcessEnv={WEEKLY_DIALOGUE_READY:'1',WEEKLY_DIALOGUE_PILOT:'0',WEEKLY_TOOLS_READY:'0',WEEKLY_TOOL_SECRET:undefined,WEEKLY_TOOLS_PILOT_HASH:undefined,SPEECHIFY_SEND_VARIABLES:'1',
    SPEECHIFY_FIRST_CALL_AGENT_ID:'first-agent',SPEECHIFY_AGENT_ID:'return-agent',SPEECHIFY_FEMALE_FIRST_CALL_AGENT_ID:'female-first-agent',SPEECHIFY_FEMALE_AGENT_ID:'female-return-agent',
    SPEECHIFY_DIALOGUE_FIRST_CALL_AGENT_ID:'dialogue-first',SPEECHIFY_DIALOGUE_AGENT_ID:'dialogue-return',SPEECHIFY_DIALOGUE_FEMALE_FIRST_CALL_AGENT_ID:'dialogue-female-first',SPEECHIFY_DIALOGUE_FEMALE_AGENT_ID:'dialogue-female-return'};
  const before=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  for(const[key,value]of Object.entries(values)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  try{
    await enrol();await enrol(phoneB);await db!.store.upsertProfile(phoneB,{voice:'female'});
    const d=deps();await tick(d,now);
    assert.equal(wire.length,2);
    const forPhone=(phone:string,offset=0)=>wire.slice(offset).find(body=>body['to']===phone)!;
    assert.equal(forPhone(phoneA)['agent_id'],'dialogue-first');
    assert.equal(forPhone(phoneB)['agent_id'],'dialogue-female-first');
    for(const body of wire)assert.deepEqual(JSON.parse((body['dynamic_variables'] as Record<string,string>)['weekly_context']!),{available:false,dialogue_policy:DIALOGUE_POLICY});
    await assert.rejects(weeklyTool(d,{attempt_id:'ordinary',session_token:'forged',command:'status'},now),{code:'unauthorized'});
    const server=controlPlane(d,secret);
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
    const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/speechify`;
    const post=async(payload:unknown)=>{
      const body=JSON.stringify(payload),timestamp=Math.floor(Date.now()/1000),signature=createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
      const response=await fetch(url,{method:'POST',body,headers:{'speechify-signature':`t=${timestamp},v0=${signature}`}});
      assert.equal(response.status,200);
    };
    for(const[phone,prefix]of [[phoneA,'alpha'],[phoneB,'beta']] as const){
      const id=`wire_${wire.indexOf(forPhone(phone))+1}`;
      const payload=event(id,[
        ['assistant',fill('read.first.keep',{eight:`${prefix} games`,eighty:`${prefix} family`,goals:`${prefix} sailing`})],['user','Yes.'],['assistant',fill('onboarding.confirmed')],
        ['user',`I choose to book ${prefix} lessons.`],['assistant',fill('next.confirm',{commitment:`book ${prefix} lessons`})],['user','Yes.'],['assistant',fill('next.agreed')],
      ]);
      await post(payload);await post(payload);
      const saved=await db!.store.load(phone);
      assert.equal(saved.callNumber,2);assert.equal(saved.onboarding,'complete');assert.equal(saved.lastCommitment,`book ${prefix} lessons`);
    }
    assert.equal(messages.length,2,'each signed first-call completion creates exactly one recap');
    await tick(d,nextWeek);assert.equal(wire.length,4);
    for(const[phone,prefix,agent]of [[phoneA,'alpha','dialogue-return'],[phoneB,'beta','dialogue-female-return']] as const){
      const body=forPhone(phone,2),vars=body['dynamic_variables'] as Record<string,string>;
      assert.equal(body['agent_id'],agent);assert.equal(vars['last_commitment'],`book ${prefix} lessons`);
      assert.equal(vars['own_eight'],`${prefix} games`);assert.equal(vars['own_eighty'],`${prefix} family`);assert.equal(vars['own_goals'],`${prefix} sailing`);
      assert.deepEqual(JSON.parse(vars['weekly_context']!),{available:false,dialogue_policy:DIALOGUE_POLICY});
    }
    const returning=forPhone(phoneA,2),id=`wire_${wire.indexOf(returning)+1}`;
    const unconfirmed=event(id,[
      ['user','I completed the previous action.'],['assistant',fill('last.did')],
      ['assistant',fill('next.confirm',{commitment:'redo the unchosen flyer'})],['user','Right, thank you.'],['assistant',fill('next.agreed')],['assistant','Goodbye.'],
    ]);
    await post(unconfirmed);await post(unconfirmed);
    assert.equal((await db!.store.load(phoneA)).lastCommitment,'book alpha lessons','global dialogue-only settlement must reject courtesy as action consent');
    assert.equal((await db!.store.load(phoneA)).callNumber,3,'duplicate return callback cannot advance twice');
    assert.equal((await db!.store.load(phoneB)).callNumber,2,'another caller remains untouched');
    assert.equal(messages.length,3,'the returning call also has exactly one recap');
    assert.doesNotMatch(JSON.stringify(messages),/redo the unchosen flyer/);
    assert.equal((await db!.sql`select count(*)::int as n from message_outbox where kind='recap'`)[0]!['n'],3);
  }finally{for(const[key,value]of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

for (const repaired of [false, true]) test(`goals-only confirmation cannot complete the map; full repair persists all parts: ${repaired}`, options, async () => {
  await enrol();
  const d=deps();await tick(d,now);
  const lines:Array<['user'|'assistant',string]>=[
    ['user','Playing games matters to my younger self. Time with family matters at eighty. I want to learn to sail.'],
    ['assistant','So, the next three months: learn to sail. Have I got that right?'],['user','Yes.'],
  ];
  if(repaired)lines.push(['assistant',fill('read.first.keep',{eight:'playing games',eighty:'time with family',goals:'learn to sail'})],['user','Yes, exactly.']);
  lines.push(['assistant',fill('onboarding.confirmed')],['user','I choose to phone the sailing school.'],
    ['assistant',fill('next.confirm',{commitment:'phone the sailing school'})],['user','Yes.'],['assistant',fill('next.agreed')]);
  const payload=event('wire_1',lines);
  await settleConversation(payload,d,undefined,now);
  await settleConversation(payload,d,undefined,now);
  const saved=await db!.store.load(phoneA);
  assert.equal(saved.lastCommitment,'phone the sailing school');
  assert.equal(saved.eight,repaired?'playing games':undefined);
  assert.equal(saved.eighty,repaired?'time with family':undefined);
  assert.equal(saved.goals,repaired?'learn to sail':undefined);
  assert.equal(saved.onboarding,repaired?'complete':'in_progress');
  assert.equal(saved.callNumber,2,'duplicate webhook must not advance the call again');
  await tick(d,nextWeek);
  const next=wire[1]!,vars=next['dynamic_variables'] as Record<string,string>;
  assert.equal(next['agent_id'],repaired?'return-agent':'first-agent');
  assert.equal(vars['last_commitment'],'phone the sailing school');
  assert.equal(vars['own_eight'],repaired?'playing games':NOTHING_RECORDED);
  assert.equal(vars['own_eighty'],repaired?'time with family':NOTHING_RECORDED);
  assert.equal(vars['own_goals'],repaired?'learn to sail':NOTHING_RECORDED);
});

test('signed webhook → encrypted memory → next outbound request and prompt, isolated for two callers', options, async t => {
  await enrol(); await enrol(phoneB);
  const d = deps();
  await tick(d, now);
  assert.equal(wire.length, 2);
  assert.ok(wire.every(body => body['agent_id'] === 'first-agent'));
  const idFor = (phone: string) => `wire_${wire.findIndex(body => body['to'] === phone) + 1}`;
  const server = controlPlane(d, secret);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/speechify`;
  async function post(payload: unknown, signed = true) {
    const body = JSON.stringify(payload), timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return fetch(url, { method: 'POST', body, headers: signed ? { 'speechify-signature': `t=${timestamp},v0=${signature}` } : {} });
  }
  const alpha = event(idFor(phoneA), [
    ['assistant', fill('read.first.keep', { eight: 'alpha games', eighty: 'alpha family', goals: 'alpha garden' })],
    ['user', 'No, change eight.'], ['assistant', fill('read.first.fix_eight', { eight: 'alpha drawing' })],
    ['user', 'Yes, exactly.'], ['assistant', fill('onboarding.confirmed')],
    ['user', 'Plant alpha seeds.'], ['assistant', fill('next.confirm', { commitment: 'plant alpha seeds' })],['user','Yes.'], ['assistant', 'Right. Goodbye.'],
  ]);
  assert.equal((await post(alpha, false)).status, 401);
  assert.equal((await db!.store.load(phoneA)).callNumber, 1);
  assert.equal((await post(alpha)).status, 200);
  assert.equal((await post(alpha)).status, 200);
  assert.equal(messages.length, 1, 'duplicate webhook cannot produce a second recap');
  await post(event(idFor(phoneB), [
    ['assistant', fill('read.first.keep', { eight: 'beta books', eighty: 'beta family', goals: 'beta lessons' })],
    ['user', 'Yes.'], ['assistant', fill('onboarding.confirmed')], ['user', 'Book beta lessons.'], ['assistant', fill('next.confirm', { commitment: 'book beta lessons' })],['user','Yes.'],
  ]));
  assert.equal((await db!.store.load(phoneA)).callNumber, 2);
  const sealed = await db!.sql`select last_commitment_enc, eight_enc, goals_enc from callers`;
  assert.doesNotMatch(JSON.stringify(sealed), /alpha|beta/);
  await tick(d, nextWeek);
  assert.equal(wire.length, 4);
  for (const [phone, prefix, eight] of [[phoneA, 'alpha', 'alpha drawing'], [phoneB, 'beta', 'beta books']] as const) {
    const body = wire.slice(2).find(body => body['to'] === phone)!;
    assert.equal(body['agent_id'], 'return-agent');
    const vars = body['dynamic_variables'] as Record<string, string>;
    assert.equal(vars['own_eight'], eight);
    assert.equal(vars['own_goals'], prefix === 'alpha' ? 'alpha garden' : 'beta lessons');
    assert.doesNotMatch(JSON.stringify(vars), prefix === 'alpha' ? /beta/ : /alpha/);
    const prompt = buildInstructions(script, { callNumber: Number(vars['call_number']), onboardingProgress: vars['onboarding_progress'], lastCommitment: vars['last_commitment'], eight: vars['own_eight'], eighty: vars['own_eighty'], goals: vars['own_goals'] });
    assert.ok(prompt.includes(vars['last_commitment']!));
    assert.ok(prompt.includes(eight));
    assert.match(prompt, /THIS IS NOT THE FIRST CALL/);
    const rendered = weeklyPrompt(false).replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key] ?? '');
    assert.ok(rendered.includes(`Last time, you said: ${vars['last_commitment']}. How did it go?`));
    assert.ok(rendered.includes(eight));
    assert.doesNotMatch(rendered, /\{\{/);
  }
});

for (const [resultLine, resultField] of [['last.did', 'weeksDone'], ['last.partial', 'weeksPartly'], ['nothing.c.follow', 'weeksUndone']] as const) {
  test(`new wording persists ${resultField} and carries the chosen action to the next request`, options, async () => {
    await enrol();
    await db!.store.record(phoneA, { at: now.toISOString(), durationMs: 100_000, commitment: 'original action', eight: 'drawing', eighty: 'family', goals: 'learn to sail', onboardingComplete: true });
    const d = deps();
    await tick(d, now);
    const payload = event('wire_1', [
      ['user', 'Here is how the action went.'], ['assistant', fill(resultLine)],
      ['user', 'Next I choose to phone the school.'], ['assistant', fill('next.confirm', { commitment: 'phone the sailing school' })], ['user', 'Yes.'], ['assistant', fill('next.agreed')],
    ]);
    await settleConversation(payload, d, undefined, now);
    await settleConversation(payload, d, undefined, now);
    const profile = await db!.store.load(phoneA);
    assert.equal(profile[resultField], 1, 'a duplicate completion cannot count the result twice');
    assert.equal(profile.lastCommitment, 'phone the sailing school');
    assert.equal(profile.eight, 'drawing');
    assert.equal(profile.eighty, 'family');
    assert.equal(profile.goals, 'learn to sail');
    await tick(d, nextWeek);
    const vars = wire[1]!['dynamic_variables'] as Record<string, string>;
    assert.equal(vars['last_commitment'], 'phone the sailing school');
    assert.equal(vars['own_eight'], 'drawing');
    assert.equal(vars['own_goals'], 'learn to sail');
    assert.doesNotMatch(JSON.stringify(vars), /original action/);
  });
}

test('no-action clears the old action; incomplete extraction preserves it; a new action clears an old day', options, async () => {
  await enrol();
  await db!.store.record(phoneA, { at: now.toISOString(), durationMs: 100_000, commitment: 'old action', day: 'Monday', onboardingComplete: true });
  await db!.store.record(phoneA, { at: now.toISOString(), durationMs: 100_000 });
  assert.equal((await db!.store.load(phoneA)).lastCommitment, 'old action');
  await db!.sql`update callers set consecutive_undone = 2`;
  await tick(deps(), now);
  await settleConversation(event('wire_1', [['user', 'No action this week.'], ['assistant', fill('next.none')]]), deps(), undefined, now);
  assert.equal((await db!.store.load(phoneA)).lastCommitment, undefined);
  assert.equal((await db!.store.load(phoneA)).lastCommitmentDay, undefined);
  assert.equal((await db!.store.load(phoneA)).consecutiveUndone, 0, 'a chosen no-action week breaks the running pattern');
  await tick(deps(), nextWeek);
  const vars = wire[1]!['dynamic_variables'] as Record<string, string>;
  assert.equal(vars['last_commitment'], NOTHING_RECORDED);
  await db!.store.record(phoneA, { at: nextWeek.toISOString(), durationMs: 100_000, commitment: 'new action' });
  assert.equal((await db!.store.load(phoneA)).lastCommitmentDay, undefined);
});

test('an authenticated correction wins over a delayed call and suppresses its stale recap', options, async () => {
  await enrol(); await tick(deps(), now);
  const hash = phoneKey(phoneA), before = await readMemory(db!.sql, hash);
  assert.ok(before);
  assert.equal(await correctMemory(db!.sql, hash, before.revision, 'corrected action', 'corrected goals'), 'saved');
  await settleConversation(event('wire_1', [['user', 'Old action.'], ['assistant', fill('next.confirm', { commitment: 'old action' })]]), deps(), undefined, now);
  const after = await db!.store.load(phoneA);
  assert.equal(after.lastCommitment, 'corrected action');
  assert.equal(after.goals, 'corrected goals');
  assert.equal(messages.length, 0);
  assert.equal((await db!.sql`select reason from message_outbox`)[0]?.['reason'], 'memory_corrected');
  await tick(deps(), nextWeek);
  const vars = wire[1]!['dynamic_variables'] as Record<string, string>;
  assert.equal(vars['last_commitment'], 'corrected action');
  await settleConversation(event('wire_2', [['user', 'New chosen action.'], ['assistant', fill('next.confirm', { commitment: 'new chosen action' })],['user','Yes.']]), deps(), undefined, nextWeek);
  assert.equal((await db!.store.load(phoneA)).lastCommitment, 'new chosen action', 'later calls may update corrected memory');
  assert.equal(messages.length, 1);
});

test('STOP, pause, safety, billing end and moved schedule between claim and placement prevent dispatch without a missed-call notice', options, async () => {
  for (const field of ['all_calls_stopped', 'paused', 'held_for_review', 'billing_status', 'next_call_at']) {
    await enrol();
    const d = deps(), claim = d.scheduler.claimDue.bind(d.scheduler);
    d.scheduler.claimDue = async at => {
      const claims = await claim(at);
      if (field === 'billing_status') await db!.sql`update callers set billing_status = 'ended'`;
      else if (field === 'next_call_at') await db!.sql`update callers set next_call_at = next_call_at + interval '1 day'`;
      else await db!.sql`update callers set ${db!.sql(field)} = true`;
      return claims;
    };
    assert.deepEqual(await tick(d, now), { claimed: 1, placed: 0, failed: 1 }, field);
    assert.equal(wire.length, 0);
    assert.equal(messages.length, 0);
    assert.equal((await db!.sql`select note from call_attempts`)[0]?.['note'], 'suppressed before placement');
    await db!.sql`delete from callers`;
    await db!.sql`delete from call_attempts`;
  }
});

test('a STOP committed during carrier backoff prevents the retry', options, async () => {
  await enrol();
  let stopped: Promise<unknown> | undefined;
  providerReply = () => {
    stopped = db!.sql`update callers set all_calls_stopped = true`;
    // Start the preference write without waiting inside the placement lock.
    void stopped.then(() => undefined);
    return Response.json({ error: { message: 'carrier congestion' } }, { status: 503 });
  };
  assert.equal((await tick(deps(), now)).placed, 0);
  await stopped;
  assert.equal(wire.length, 1);
  assert.equal(messages.length, 0);
});

test('a local transaction failure after acceptance never places the same call again', options, async () => {
  await enrol();
  await db!.store.setRehearseFirstCall(phoneA, true);
  const d = deps(), original = d.store.in.bind(d.store);
  d.store.in = tx => {
    const scoped = original(tx);
    scoped.clearRehearseFirstCall = async () => { throw new Error('synthetic local failure after provider acceptance'); };
    return scoped;
  };
  try {
    assert.deepEqual(await tick(d, now), { claimed: 1, placed: 1, failed: 0 });
    assert.equal(wire.length, 1);
    assert.equal(messages.length, 0);
    assert.equal((await db!.sql`select provider_call_id from call_attempts`)[0]?.['provider_call_id'], 'wire_1');
  } finally { d.store.in = original; }
});

test('a lost commit acknowledgement cannot rewind a conversation already settled by its webhook', options, async () => {
  await enrol();
  const d = deps(), raw = d.store.raw, original = raw.begin;
  let simulated = false;
  const payload = event('wire_1', [['user', 'Book a lesson.'], ['assistant', fill('next.confirm', { commitment: 'book a lesson' })],['user','Yes.']]);
  raw.begin = (async (...args: unknown[]) => {
    const result: unknown = await Reflect.apply(original, raw, args);
    if (wire.length === 1 && !simulated) {
      simulated = true;
      await settleConversation(payload, d, undefined, now);
      throw new Error('synthetic lost acknowledgement after a successful commit');
    }
    return result;
  }) as typeof raw.begin;
  try {
    assert.equal((await tick(d, now)).placed, 1);
    assert.equal(wire.length, 1);
    assert.equal((await db!.sql`select status from call_attempts`)[0]?.['status'], 'completed');
    assert.equal((await settleConversation(payload, d, undefined, now)).handled, false);
    assert.equal((await db!.store.load(phoneA)).callNumber, 2);
    assert.equal(messages.length, 1);
  } finally { raw.begin = original; }
});

test('safety holds suppress both a pending recap and call SMS', options, async () => {
  await enrol(); await tick(deps(), now);
  const [attempt] = await db!.sql`select id from call_attempts`;
  await db!.sql`update call_attempts set safety_tier = 2`;
  for (const kind of ['recap', 'call'] as const) {
    const id = await enqueue(db!.sql, { eventKey: `safety:${kind}`, phoneHash: phoneKey(phoneA), channel: kind === 'recap' ? 'email' : 'sms', kind, reference: attempt!['id'], to: kind === 'recap' ? 'alpha@example.com' : phoneA, body: kind === 'recap' ? { subject: 'Synthetic', body: 'Private', parts: [] } : 'Private' }, now);
    assert.equal(await dispatchMessage(deps(), id, now), 'suppressed');
  }
  assert.equal(messages.length, 0);
});
