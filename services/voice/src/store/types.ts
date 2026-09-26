/**
 * What we remember about a caller between calls.
 *
 * Deliberately small. This is an accountability call, not a file on someone:
 * the commitment in their own words, their answers to the eight and eighty
 * questions, an assumption they chose to test, how many calls there have
 * been, and how many weeks in a row it came back undone. Nothing here is a conclusion about
 * the person — see the precedent in DECISIONS.md.
 */
export interface CallerRecord {
  /** E.164. The identity of a caller is their number until there are accounts. */
  phone: string;
  name?: string;
  /** Where the recap the close promised is sent. */
  email?: string;
  language?: string;
  /** 'female' | 'male' | a provider voice name. Their choice, not a default. */
  voice?: string;
  /** This is call number N. 1 means they have never been called. */
  callNumber: number;
  /** What they said they would do, in their own words. */
  lastCommitment?: string;
  /** The day they named for it. */
  lastCommitmentDay?: string;
  /**
   * Weeks in a row the commitment came back undone. Only ever incremented from
   * what the caller actually said, and it changes how the mentor LISTENS —
   * never what it concludes out loud without a human in the loop.
   */
  consecutiveUndone: number;
  /**
   * How the weeks went, counted: the commitment done, partly done, or not.
   * Counts only, never which week was which — enough to say whether the call
   * works, and nothing more about a person than that.
   */
  weeksDone?: number;
  weeksPartly?: number;
  weeksUndone?: number;
  /** Learned from their own pause distribution. */
  patienceOffsetMs?: number;
  /**
   * Their own eight and eighty, from the first call, in their words: what they
   * loved doing at eight, and what at eighty they would be sorry never to have
   * tried. Their answers to a question, not a conclusion about them.
   */
  eight?: string;
  eighty?: string;
  /**
   * An assumption about the work they named and chose to test, in their words.
   * Kept so next week can ask what the test showed — never so it can be said
   * back to them again.
   */
  belief?: string;
}

/** What one call produced. */
export interface CallOutcome {
  at: string;
  durationMs: number;
  /** The commitment for next week, if one was reached. */
  commitment?: string;
  day?: string;
  /** Whether last week's commitment happened, when the call established it. */
  lastWeek?: 'done' | 'partly' | 'undone';
  /** Read back on the call, so kept; see CallerRecord. */
  eight?: string;
  eighty?: string;
  belief?: string;
}

export interface Store {
  load(phone: string): Promise<CallerRecord>;
  record(phone: string, outcome: CallOutcome): Promise<void>;
}
