/**
 * What we remember about a caller between calls.
 *
 * Deliberately small. This is an accountability call, not a file on someone:
 * the commitment in their own words, how many calls there have been, and how
 * many weeks in a row it came back undone. Nothing here is a conclusion about
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
  /** Learned from their own pause distribution. */
  patienceOffsetMs?: number;
}

/** What one call produced. */
export interface CallOutcome {
  at: string;
  durationMs: number;
  /** The commitment for next week, if one was reached. */
  commitment?: string;
  day?: string;
}

export interface Store {
  load(phone: string): Promise<CallerRecord>;
  record(phone: string, outcome: CallOutcome): Promise<void>;
}
