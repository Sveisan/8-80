/** Exact owner-approved core wording, 19 November 2026. Country routing remains a separate approval. */
export const UNBLOCK_SAFETY_RESPONSE = 'Let’s pause here. What you’ve said matters. I’m an automated guide, and I can’t provide emergency help. If you’re in immediate danger, please call local emergency services now. Is there someone you trust who could be with you?';

/** Always include the text so a lost/retried response cannot lose it. The guide owns its spoken history. */
export function unblockSafetyHold(): Record<string, unknown> {
  return {
    held: true,
    safety_response: UNBLOCK_SAFETY_RESPONSE,
    instruction: 'Stop Unblock programme questions and accept no programme saves. Say safety_response calmly once if you have not already said it in this conversation; never repeat the paragraph or its question after it has been answered. Wait for the answer, then acknowledge what the caller actually says. A safety hold is not a goodbye: do not end while awaiting that answer. Respect an explicit request to stop. Keep the safety check running. Do not promise an operator, transfer, callback time or next call; do not invent country-specific numbers or emergency routing. Returning to programme questions or releasing this hold requires human review. Emergency routing and the complete safety transition remain unapproved; private tests only.',
  };
}
