/** Import this OpenAPI operation as weekly_assist on each weekly voice agent. */
export function weeklyOpenApi(base=process.env['PUBLIC_URL']??'https://your-service.example') {
  const url=new URL(base);if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash)throw new Error('A credential-free HTTPS PUBLIC_URL is required.');
  return {openapi:'3.0.3',info:{title:'8&80 weekly conversation controls',version:'1.0.0'},servers:[{url:url.origin}],paths:{'/weekly/tool':{post:{operationId:'weekly_assist',
    description:'Private call-scoped controls. Copy attempt_id and session_token from weekly_context; never speak credentials. Use status/context for reads. For every effect choose a new request_id, reusing it only for an identical retry. Prepare a reminder, read back the proposal and ask for agreement, then confirm only after the caller explicitly agrees. For a change prepare the full replacement. Cancellation only cancels the one pending SMS. Tips_off stops tips without stopping calls.',
    requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['attempt_id','session_token','command'],properties:{
      attempt_id:{type:'string',maxLength:120},session_token:{type:'string',maxLength:100},
      command:{type:'string',enum:['status','context','tip_presented','tip_response','tips_off','tips_on','reminder_prepare','reminder_confirm','reminder_cancel']},
      request_id:{type:'string',maxLength:80,description:'Unique effect identifier within this call, for example reminder-prepare-1. Same identifier and arguments only when retrying.'},
      text:{type:'string',maxLength:240,description:'Exact SMS wording chosen with the caller. Never instructions for the agent.'},
      date:{type:'string',format:'date',description:'Full YYYY-MM-DD local date agreed with caller.'},time:{type:'string',pattern:'^([01][0-9]|2[0-3]):[0-5][0-9]$',description:'HH:mm in the account timezone returned by status. Do not calculate UTC.'},
      after_minutes:{type:'integer',minimum:2,maximum:43200,description:'For in N minutes, pass N; server calculates the time. Omit date, time and shift_minutes.'},
      shift_minutes:{type:'integer',minimum:-43200,maximum:43200,description:'Move the pending reminder N minutes later (positive) or earlier (negative), using its current revision. Omit date, time and after_minutes.'},
      draft_id:{type:'string',description:'From reminder_prepare in this same call.'},confirmed:{type:'boolean',description:'True only after the caller explicitly agrees to the exact proposed SMS, date, time and timezone.'},
      revision:{type:'integer',description:'Current reminder revision returned by status; required for cancellation or shift_minutes.'},
      tip_id:{type:'string',description:'Exact identifier returned by context.'},response:{type:'string',enum:['accepted','declined'],description:'Explicit caller response; silence is neither.'},
    }}}}},responses:{'200':{description:'Authoritative operation result. Only saved:true or cancelled:true confirms an effect.',content:{'application/json':{schema:{type:'object',additionalProperties:true}}}},'401':{description:'Invalid call authentication.'},'409':{description:'Nothing confirmed; read the error and resolve it before making a new request.'},'503':{description:'Outcome unconfirmed; retry identical arguments with the same request_id. Never invent success.'}}}}}};
}
