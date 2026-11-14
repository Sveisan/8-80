/** Frozen rubric validated on 2026-11-14. Changes require re-evaluation. */
export const jevQuestions = {
  "repeated_question": {
    "type": "noul",
    "instructions": "Does the mentor unnecessarily ask the caller for information the caller has already clearly supplied in this conversation? Judge semantic repetition, including paraphrases, using the conversation, not the recap.",
    "criteria": {
      "true": "At least one mentor question redundantly requests already answered information, including an action after an explicit refusal. The answer remains current and there is no conversational justification for asking again.",
      "false": "No redundant question. A new relevant follow-up, checking a corrected fact, explicit read-back confirmation, a caller-requested repeat, or seeking the missing part of an incomplete answer is justified. Repeating the same words alone is insufficient evidence."
    }
  },
  "unsupported_recap": {
    "type": "noul",
    "instructions": "Does the candidate recap contain at least one substantive claim about the caller, their choice, their outcome or a booking that is unsupported or contradicted by the conversation and trusted context?",
    "criteria": {
      "true": "Includes an invented or contradicted action, person, time, quantity, motive, diagnosis, outcome or cause; presents tentative plans or quoted third-party advice as the caller's confirmed commitment; drops a material condition, refusal or correction.",
      "false": "All substantive claims follow from what the caller actually said or confirmed and the trusted context. Faithful paraphrases, omissions of nonessential detail and a recap recording no chosen action are allowed. Generic thanks or sign-off is not a factual invention."
    }
  }
} as const;
