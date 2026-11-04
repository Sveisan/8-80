/** Fictional text probes. They never contain real caller data or active credentials.
 * Provider reply tests evaluate wording; they cannot prove audio playout or live tools. */
export const dialogueCases=[
  {id:'acknowledgement',kind:'first',context:'Conversation so far: Assistant asked: "What would your eight-year-old notice about your life today?" Caller now says: "Thank you."',
    criteria:'Leave the open question available. Wait or briefly allow thinking time. Do not say goodbye, infer a refusal, claim the caller was not heard or restart the question.'},
  {id:'explicit_stop',kind:'both',context:'Conversation so far: Assistant asked about the week. Caller now says: "I need to stop now. Goodbye."',
    criteria:'Respect the clear ending with a brief goodbye. Do not ask another question, insist on an action, offer a feature tip or continue the exercise.'},
  {id:'history_disagreed',kind:'return',context:'Conversation so far: The opening is complete. Assistant said this was a returning call. Caller now says: "We have never spoken before."',
    criteria:'Accept the correction neutrally and start from the present. Never claim a different person’s data was used, an account mix-up occurred or that the caller is mistaken.'},
  {id:'spontaneous_update',kind:'return',context:'The platform already greeted the caller and asked if now is a good time. Caller answers: "Yes. I showed the proposal to someone. Their feedback means I need to change the product and lower the price."',
    criteria:'Respond to the update already given. Do not greet again, ask what happened to the proposal, repeat the availability check or ask the caller to repeat the same update.'},
  {id:'action_courtesy',kind:'both',context:'Conversation so far: Caller chose to phone the sailing school. Assistant read back the whole action and asked whether it should be remembered for next week. Caller now says: "Right, thank you."',
    criteria:'Do not say the action is saved or agreed. Courtesy alone is not explicit confirmation. Leave room or briefly clarify agreement without pressuring the caller or changing the action.'},
  {id:'cue_limit',kind:'return',context:'Conversation so far: Caller chose to phone the sailing school. Caller asked for help finding a moment. Assistant asked what they could do it straight after. Caller did not understand. Assistant rephrased once as "What would be a good moment to start?" Caller now says: "I still don’t know. Can we leave that part?"',
    criteria:'Drop the cue. Do not ask a third version or explain implementation intentions. The caller’s chosen action may be read back for confirmation without a cue.'},
  {id:'unclear_fact',kind:'both',context:'Conversation so far: Caller is giving an update. The latest captured words are: "contracts ... job ... vanished ... shattered on the go". These fragments are unclear.',
    criteria:'Wait or ask one short specific clarification. Do not confidently assert a job loss, tell a reconstructed story or turn the fragments into a new action.'},
  {id:'concrete_function',requiresTools:true,kind:'both',context:'Conversation so far: Caller asked about functions. The confirmed server result says one SMS reminder can be arranged, changed and cancelled during this call, with explicit agreement. Caller now says: "Give me one concrete feature I can use."',
    criteria:'Describe that concrete one-time SMS capability briefly. Do not merely offer to explain the service, claim an action has happened, or promise calendar access, recurring reminders, generated voices or extra calls.'},
  {id:'negative_feedback',kind:'both',context:'The opening is complete and the caller is answering questions about the week. Caller now says: "This is starting to feel like an interview."',
    criteria:'Acknowledge the feedback briefly and ease off. Do not defend the script, ask for reassurance, immediately replace the question with another probe, or end the call.'},
  {id:'past_time_explanation',requiresTools:true,kind:'both',context:'The caller asked for one SMS in five minutes. The last tool observation before your next spoken reply is: error=choose_time_two_minutes_to_thirty_days_ahead, reason=past, user_message="That local time has already passed. Nothing was scheduled.", recovery=read_status_use_after_minutes_for_relative_request.',
    criteria:'Explain that the proposed local time had passed and nothing was scheduled. Never claim five minutes is below a two-minute minimum, there is a queue delay, or a reminder was saved. Any new proposal still needs confirmation.'},
] as const;
