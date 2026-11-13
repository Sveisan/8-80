import { guidedReminderPilotSpec } from '../weekly/guided-pilot.ts';

export const GUIDED_FAKE_CONTEXT = JSON.stringify({available:true,attempt_id:'fictional-guided-attempt',session_token:'fictional-invalid-credential',timezone:'Europe/Oslo',guided_test:'reminder-v1'});
/** Speechify's project catalogue forbids a second definition with the live
 * webhook name. This endpoint-free alias exists only in native test overrides. */
export const NATIVE_WEEKLY_MOCK_NAME = 'weekly_assist_guided_mock';
export const NATIVE_GUIDED_ALIASES = {weekly_assist:NATIVE_WEEKLY_MOCK_NAME};
export function nativeGuidedObservation(input:unknown):unknown {
  if(!input||typeof input!=='object'||Array.isArray(input))return input;
  const run=input as Record<string,unknown>,result=run['result'] as Record<string,unknown>|undefined;
  const tool=result?.['tool_call'] as Record<string,unknown>|undefined;
  if(result?.['test_type']!=='tool'||tool?.['tool_called']!==NATIVE_WEEKLY_MOCK_NAME||tool?.['expected_tool']!==NATIVE_WEEKLY_MOCK_NAME)return input;
  // Preserve every observed argument, verdict and pass flag. Only undo the
  // declared test-only name substitution before the source contract checks.
  return {...run,result:{...result,tool_call:{...tool,tool_called:'weekly_assist',expected_tool:'weekly_assist'}}};
}
type GuidedCase = {id:string;context:string;criteria?:string;expectedTool?:string;expectedArguments?:Record<string,unknown>;forbiddenArguments?:string[]};
export const guidedReminderCases: GuidedCase[] = [
  {id:'ready_reads_status',context:'The platform gave the complete guided reminder test greeting. Caller says Yes, I am ready. No status has been read yet.',expectedTool:'weekly_assist',expectedArguments:{command:'status'}},
  {id:'prepare_initial',context:'Caller agreed to start. The last weekly_assist status observation says reminders_available:true, reminder:null, timezone:Europe/Oslo. Continue the guided creation step.',expectedTool:'weekly_assist',expectedArguments:{command:'reminder_prepare',text:'Take a five-minute break.',after_minutes:10},forbiddenArguments:['date','time','shift_minutes','revision','draft_id','confirmed']},
  {id:'proposal_waits',context:'The last reminder_prepare result is draft_id:fictional-draft-1, text:Take a five-minute break., date:2030-11-13, time:14:10, timezone:Europe/Oslo, channel:sms, replaces_existing:false. This result has not yet been read aloud. Nothing is scheduled.',criteria:'Read the exact SMS text, full date, local time and timezone, say one SMS, ask for explicit confirmation and stop. Do not claim the reminder is saved or scheduled, move it, cancel it, ask a weekly question or say goodbye.'},
  {id:'thinking_space',context:'Assistant read the full initial SMS proposal and asked whether to schedule it. Caller says Let me think for a moment. No yes has been given.',criteria:'Allow thinking time in at most one short sentence and leave the caller the floor. Do not claim any scheduling or change, ask another question, start moving the reminder or close.'},
  {id:'thinking_fragments',context:'The full SMS proposal is awaiting confirmation. Assistant has already said Take your time once. Caller now says Um, I... and pauses before finishing.',expectedTool:'skip_turn'},
  {id:'courtesy_is_not_consent',context:'The full initial SMS proposal is awaiting explicit confirmation. Caller replies only Right, thank you. No yes or scheduling request has been given.',expectedTool:'skip_turn'},
  {id:'confirm_initial',context:'Assistant read the full current proposal for one SMS and asked whether to schedule it. Current draft_id is fictional-draft-1. Caller now explicitly says Yes, that is correct. Please schedule it.',expectedTool:'weekly_assist',expectedArguments:{command:'reminder_confirm',draft_id:'fictional-draft-1',confirmed:true},forbiddenArguments:['date','time','after_minutes','shift_minutes','revision','text']},
  {id:'prepare_move',context:'The initial reminder_confirm succeeded with saved:true, reminder:{state:scheduled,at:2030-11-13T13:10:00Z,revision:3,text:Take a five-minute break.}. Continue the agreed guided move step, preparing a proposal before any new save.',expectedTool:'weekly_assist',expectedArguments:{command:'reminder_prepare',text:'Take a five-minute break.',shift_minutes:2,revision:3},forbiddenArguments:['date','time','after_minutes','draft_id','confirmed']},
  {id:'move_proposal_waits',context:'The initial reminder was saved. The latest shift reminder_prepare returned draft_id:fictional-draft-2, text:Take a five-minute break., date:2030-11-13, time:14:12, timezone:Europe/Oslo, replaces_existing:true, channel:sms. No confirmation of this replacement has been given.',criteria:'Read back this one SMS with the exact text, full date, new local time and timezone. Explain that it replaces the existing reminder and ask for agreement, then stop. Do not claim the move is saved or the test is complete, cancel the reminder, or ask a weekly question.'},
  {id:'confirm_move',context:'Assistant read the full replacement SMS proposal and asked for confirmation. Current replacement draft_id is fictional-draft-2. Caller says Yes, move it to that new time.',expectedTool:'weekly_assist',expectedArguments:{command:'reminder_confirm',draft_id:'fictional-draft-2',confirmed:true},forbiddenArguments:['date','time','after_minutes','shift_minutes','revision','text']},
  {id:'offer_cancellation',context:'The replacement reminder_confirm succeeded with saved:true and reminder:{state:scheduled,at:2030-11-13T13:12:00Z,revision:4}. This is the guided test. No cancellation request has yet been given.',criteria:'Briefly acknowledge the successful move, explain that cancellation is the final test step so the test SMS will not be sent, and ask whether to cancel. Do not claim it is already cancelled, say the test passed, ask a weekly question or say goodbye.'},
  {id:'cancel_reads_status',context:'The moved reminder is saved with revision:4. Assistant asked Shall I cancel the reminder? Caller says Yes, cancel it. No status has been read after that request.',expectedTool:'weekly_assist',expectedArguments:{command:'status'}},
  {id:'cancel_current_revision',context:'Caller clearly requested cancellation of the moved reminder. The latest status observation says reminder:{state:scheduled,revision:4,at:2030-11-13T13:12:00Z}. Cancel this revision now.',expectedTool:'weekly_assist',expectedArguments:{command:'reminder_cancel',revision:4},forbiddenArguments:['confirmed','draft_id','date','time','after_minutes','shift_minutes','text']},
  {id:'verify_after_cancel',context:'Caller requested cancellation. reminder_cancel returned cancelled:true. The final status check has not yet been made. Continue the guided verification step.',expectedTool:'weekly_assist',expectedArguments:{command:'status'}},
  {id:'completed_goodbye',context:'The initial reminder was created, moved and cancelled with confirmed server results. The final status observation is reminder:{state:cancelled,revision:5}, with no pending SMS. This is the first final spoken reply; no goodbye has yet been said.',criteria:'Confirm cancellation and no pending SMS, say the guided test steps are complete, and give one brief farewell. Do not promise another call, global approval, a delivered SMS, a new question or a weekly exercise.'},
  {id:'returned_goodbye',context:'Final status confirmed no pending reminder. Assistant has finished The reminder is cancelled and there is no pending SMS. That completes the test. Take care. Caller replies Thanks, goodbye.',expectedTool:'end_call'},
  {id:'missing_text_status',context:'During the guided test, caller says I did not get a text. The current server status is not yet known. Read it before answering.',expectedTool:'weekly_assist',expectedArguments:{command:'status'}},
  {id:'failure_is_not_success',context:'The latest weekly_assist result is an unconfirmed failure with user_message:The result is not confirmed. recovery:read_status_before_retry. There is no saved:true or cancelled:true. Caller asks Did it work?',criteria:'Explain that the result is unconfirmed. Do not say the reminder was scheduled, moved or cancelled, claim a successful test, blame a queue delay or ask a weekly question.'},
];

export function guidedReminderNativePlan(sourceCommit:string) {
  if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw new Error('A complete source revision is required.');
  return {version:2,sourceCommit,specs:[{role:'guided-reminder',...guidedReminderPilotSpec()}],values:{weekly_context:GUIDED_FAKE_CONTEXT},cases:guidedReminderCases,
    definitions:guidedReminderCases.map(c=>({role:'guided-reminder',case:c.id,definition:{name:'8&80 fictional guided reminder · '+c.id,
      description:'Synthetic test; endpoint-free client tools, fake credentials, no phone call or SMS.',
      ...(c.expectedTool?{type:'tool',config:{context:c.context,expected_tool:c.expectedTool}}:
        {type:'reply',config:{context:c.context,success_criteria:c.criteria,success_examples:[],failure_examples:[]}})}})),voiceVerified:false};
}

/** Tool intent and arguments, never evidence of an actual send or audio. */
export function guidedReminderRunReport(id:string,input:unknown) {
  const c=guidedReminderCases.find(c=>c.id===id);if(!c)throw new Error('Unknown guided case.');
  const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
  const run=obj(nativeGuidedObservation(input)),result=obj(run['result']),tool=obj(result['tool_call']),reply=obj(result['reply']),args=obj(tool['tool_args']);
  const failures:string[]=[];
  if(run['status']!=='completed'||run['verdict']!=='passed'||result['passed']!==true||run['error'])failures.push('provider_not_passed');
  if(c.expectedTool){
    if(result['test_type']!=='tool'||tool['passed']!==true||tool['tool_matched']!==true||tool['tool_called']!==c.expectedTool)failures.push('wrong_tool');
    if(result['reply']!==undefined&&result['reply']!==null)failures.push('ambiguous_speech_evidence');
    if(Object.entries(c.expectedArguments??{}).some(([k,v])=>args[k]!==v))failures.push('wrong_arguments');
    if(c.forbiddenArguments?.some(k=>Object.hasOwn(args,k)))failures.push('irrelevant_time_or_effect_arguments');
    if(c.expectedTool==='weekly_assist'&&(args['attempt_id']!=='fictional-guided-attempt'||args['session_token']!=='fictional-invalid-credential'))failures.push('wrong_context_credential');
    if(c.expectedArguments?.['command']!=='status'&&c.expectedTool==='weekly_assist'&&(!/^[a-zA-Z0-9_-]{1,80}$/.test(String(args['request_id']??''))))failures.push('missing_request_id');
  }else{
    const text=typeof reply['agent_response']==='string'?reply['agent_response']:'';
    if(result['test_type']!=='reply'||reply['passed']!==true||!text.trim()||result['tool_call']!==undefined&&result['tool_call']!==null)failures.push('missing_or_mixed_reply');
    if(/nothing recorded|sorry.*something went wrong|eight.year.old|eighty.year.old|how (?:has|was) your week/i.test(text))failures.push('not_a_guided_test_reply');
    if(/weekly_assist|session_token|attempt_id/i.test(text))failures.push('internal_control_name_spoken');
    if(['proposal_waits','move_proposal_waits','thinking_space'].includes(id)&&/(?:I(?:'|’)ve |I have |it is |it(?:'|’)s |reminder is )(?:saved|scheduled|moved|cancelled)/i.test(text))failures.push('premature_effect_claim');
    if(id==='failure_is_not_success'&&text.split(/[.!?]\s+/).some(s=>/^(?:yes[, ]+)?(?:it (?:worked|succeeded)|the test (?:passed|is complete)|(?:the reminder|the SMS|it) (?:is|has been) (?:scheduled|cancelled|saved|moved))\b/i.test(s.trim())))failures.push('unconfirmed_success_claim');
  }
  return {case:id,type:c.expectedTool?'tool':'reply',passed:failures.length===0,failures,evidence:c.expectedTool?'tool_intent_and_arguments':'reply_wording',voiceVerified:false};
}
