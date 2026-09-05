/**
 * The voice provider interface.
 *
 * Grok was chosen without a bake-off against the model that leads on
 * conversational dynamics, so the ability to switch is the insurance that makes
 * that choice reversible. Nothing above this boundary may know which provider
 * is beneath it: no provider event names, no provider audio framing, no
 * provider quirks. If a Grok-specific workaround is needed it lives in grok.ts.
 */

export type AudioFormat =
  | { kind: 'pcmu'; rate: 8000 }
  | { kind: 'pcm16'; rate: 8000 | 16000 | 24000 };

export interface VoiceSessionConfig {
  instructions: string;
  /** Per-user, never hardcoded. Language is a field from day one. */
  language: string;
  voice: string;
  input: AudioFormat;
  output: AudioFormat;
  /**
   * When false, the provider must not decide turns — we do, in our own
   * endpointer, and we call respond() explicitly.
   */
  providerTurnDetection: false | { silenceMs: number; threshold: number; prefixPaddingMs: number };
}

export interface VoiceEvents {
  onReady?(): void;
  /** Audio for the caller, in the configured output format. */
  onAudio?(chunk: Buffer): void;
  onAgentSpeechStarted?(at: number): void;
  onAgentSpeechDone?(at: number): void;
  onAgentTranscript?(text: string, final: boolean): void;
  onUserTranscript?(text: string, final: boolean): void;
  onError?(err: Error): void;
  onClosed?(code?: number): void;
}

export interface VoiceSession {
  /** Caller audio in, in the configured input format. */
  sendAudio(chunk: Buffer): void;
  /**
   * Ask the model to take its turn now. Only used when we own turn-taking.
   *
   * `commitInput: false` opens a turn without committing caller audio — used
   * for the greeting, before the caller has said anything.
   */
  respond(opts?: { commitInput?: boolean }): void;
  /** Stop the model mid-utterance — a real barge-in, not a backchannel. */
  cancel(): void;
  /** Replace the live instructions; how the in-call correction buffer is applied. */
  updateInstructions(instructions: string): void;
  /** Discard buffered caller audio without producing a turn. */
  clearInput(): void;
  close(): void;
}

export interface VoiceProvider {
  readonly name: string;
  connect(cfg: VoiceSessionConfig, events: VoiceEvents): Promise<VoiceSession>;
}
