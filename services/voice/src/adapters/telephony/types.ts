/**
 * Telephony behind a provider-agnostic interface. Telnyx first; a Twilio
 * adapter is the documented fallback. No provider webhook shape reaches the
 * call loop.
 */
export interface PlaceCallOptions {
  to: string;
  from: string;
  /** Ring this long and then stop. We never leave voicemail. */
  ringSeconds: number;
  /** Public wss:// endpoint this call's media should stream to. */
  streamUrl: string;
}

export interface CallHandle {
  id: string;
  hangup(): Promise<void>;
}

/** Per-call media, handed to the call loop once the leg is streaming. */
export interface MediaBridge {
  /** Caller audio, PCMU 8k. */
  onAudio(cb: (chunk: Buffer) => void): void;
  onHangup(cb: () => void): void;
  /** Audio to play to the caller, PCMU 8k. */
  send(chunk: Buffer): void;
  /**
   * Audio queued but not yet played to the caller, in milliseconds.
   *
   * The model finishes generating long before the caller finishes hearing, so
   * "is the agent speaking?" cannot be answered by the model's own events.
   */
  pendingMs(): number;
  /**
   * Drop audio already handed to the carrier but not yet heard.
   *
   * Without this a barge-in does not stop the agent: cancelling the model only
   * stops it producing more, while everything already sent stays queued at the
   * carrier and plays over the person who interrupted. Cancelling the model and
   * cancelling the sound are two different acts.
   */
  clear(): void;
  close(): void;
}

export interface TelephonyProvider {
  readonly name: string;
  placeCall(opts: PlaceCallOptions): Promise<CallHandle>;
}
