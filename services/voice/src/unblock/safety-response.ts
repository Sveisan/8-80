import { routingFor, type RoutingState } from './routing.ts';
/** Exact owner-approved core wording, 19 November 2026. */
export const UNBLOCK_SAFETY_RESPONSE = 'Let’s pause here. What you’ve said matters. I’m an automated guide, and I can’t provide emergency help. If you’re in immediate danger, please call local emergency services now. Is there someone you trust who could be with you?';

/** Always include the text so a lost/retried response cannot lose it. The guide owns its spoken history. */
export function unblockSafetyHold(routing?: RoutingState): Record<string, unknown> {
  return {
    held: true,
    safety_response: UNBLOCK_SAFETY_RESPONSE,
    routing: routingFor(routing),
    instruction: 'Stop Unblock programme questions and accept no programme saves. Say safety_response calmly once if you have not already said it in this conversation; never repeat the paragraph or its question after it has been answered. Wait for the answer, then acknowledge what the caller actually says. A safety hold is not a goodbye: do not end while awaiting that answer. Respect an explicit request to stop. Keep the safety check running. Only after acknowledging the support answer, ask routing.country_question if supplied and current country is still missing. Use local numbers only from routing when its country is NO; never infer location from account, phone or timezone, and never choose medical urgency from keyword tier alone. Emergency direction is immediate, alongside the existing operator alert; no automatic dial or transfer. Do not promise an operator, callback time, next call, rescue or monitoring. An alert being queued, accepted or delivered is never a human response or handoff. Acknowledge reaching help only from an explicit caller report or an actual human confirmation; do not infer it from silence, a plan to call, or the operator alert. Make room for the caller to contact help directly, respect a request to end, and do not claim a confirmed handoff when help has not been reached. A trusted person is chosen by the caller; never assume family or household members are safe. No automatic family contact, transcript disclosure or participant follow-up text. Returning to programme questions or releasing this hold requires human review. The operating procedure is owner-approved. Qualified safety/privacy review and launch activation remain separate; enrolment stays closed.',
  };
}
