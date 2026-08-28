import 'dotenv/config';

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}. See .env.example.`);
  return v;
}
function num(key: string, fallback: number): number {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : Number(v);
}

/**
 * ENDPOINTING_SENSITIVITY is THE documented endpointing knob, 0..1.
 *   0.0 = maximally patient   1.0 = maximally eager
 * Everything below is derived from it so that tuning is one number, and the
 * derived values are logged at call start so a run is reproducible.
 *
 * Default 0.25: deliberately slower to respond than a stranger would be.
 * Eagerness reads as machine, and the pause before the real answer is the product.
 */
export function endpointing(sensitivity = num('ENDPOINTING_SENSITIVITY', 0.25)) {
  const s = Math.min(1, Math.max(0, sensitivity));
  const scale = (patient: number, eager: number) => Math.round(patient + (eager - patient) * s);
  return {
    sensitivity: s,
    /** Silence after ordinary speech before we consider the turn over. */
    baseSilenceMs: scale(2000, 500),
    /** The sentence trailed off mid-clause. They are still thinking. */
    trailingClauseMs: scale(4000, 1200),
    /** One- or two-word answer. Do not fill the silence; wait for the real one. */
    shortAnswerMs: scale(3800, 1100),
    /** Multiplier after a question the script marks as hard. */
    hardQuestionFactor: 1.6,
    /**
     * Within-turn pause memory. If someone has already paused and resumed once
     * in this turn, they are speaking in fragments right now, and the next
     * pause gets at least this multiple of the longest one we have seen.
     * No lexical rule catches "I've been finding it hard" — a complete clause
     * in the middle of a disclosure — but this does.
     */
    withinTurnPauseFactor: +(2.2 + (1.2 - 2.2) * s).toFixed(2),
    /** Ceiling on that boost, so one long pause cannot make the rest glacial. */
    withinTurnMaxMs: scale(6000, 2000),
    /** Absolute ceiling, so a dead line cannot hang the call forever. */
    maxWaitMs: num('ENDPOINTING_MAX_WAIT_MS', 9000),
    /** Below this, inbound speech is treated as backchannel, not a turn. */
    backchannelMaxMs: 700,
  };
}
export type Endpointing = ReturnType<typeof endpointing>;

export const config = {
  voiceProvider: process.env.VOICE_PROVIDER ?? 'grok',
  telephonyProvider: process.env.TELEPHONY_PROVIDER ?? 'telnyx',

  xai: {
    apiKey: () => req('XAI_API_KEY'),
    model: process.env.XAI_VOICE_MODEL ?? 'grok-voice-think-fast-2.0',
    voice: process.env.XAI_VOICE_NAME ?? 'eve',
    url: process.env.XAI_REALTIME_URL ?? 'wss://api.x.ai/v1/realtime',
  },
  telnyx: {
    apiKey: () => req('TELNYX_API_KEY'),
    connectionId: () => req('TELNYX_CONNECTION_ID'),
  },
  numbers: {
    from: () => req('OUTBOUND_CALLER_NUMBER'),
    stressTarget: () => req('STRESS_TEST_TARGET_NUMBER'),
  },

  port: num('VOICE_SERVICE_PORT', 8080),
  wsPublicUrl: () => req('VOICE_WS_PUBLIC_URL'),
  ringSeconds: num('RING_SECONDS', 25),

  /**
   * 'local'    — we disable the provider's VAD and decide turns ourselves.
   * 'provider' — hand turn-taking to the provider's server_vad. Debug only.
   * See DECISIONS.md: the provider offers silence timing only, and silence
   * timing alone is the thing this product cannot use.
   */
  turnTaking: (process.env.TURN_TAKING ?? 'local') as 'local' | 'provider',

  language: process.env.CALL_LANGUAGE ?? 'en',
  variants: {
    nothing: process.env.SCRIPT_VARIANT_NOTHING ?? 'nothing.c',
    nextAsk: process.env.SCRIPT_VARIANT_NEXT_ASK ?? 'next.ask.c',
    closeQ: process.env.SCRIPT_VARIANT_CLOSE_Q ?? 'close.q.b',
  },
};
