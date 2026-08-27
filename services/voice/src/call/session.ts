import { config, endpointing, type Endpointing } from '../config.ts';
import { log } from '../log.ts';
import { HARD_TURNS, type ScriptLines } from '../script.ts';
import { buildInstructions, type CallerProfile } from '../prompt.ts';
import { CallMetrics } from '../metrics.ts';
import { rms } from '../audio/mulaw.ts';
import { silenceBudgetMs, isBackchannel } from '../turn/endpointer.ts';
import { CorrectionBuffer, agentCutUserOff, classifyOverlap, detectCorrectionPhrase } from './corrections.ts';
import { Timekeeper } from './timekeeper.ts';
import type { MediaBridge } from '../adapters/telephony/types.ts';
import type { VoiceProvider, VoiceSession } from '../adapters/voice/types.ts';

const SPEECH_RMS = Number(process.env.VAD_RMS_THRESHOLD ?? 0.035);
/** Telnyx sends 20ms PCMU frames. */
const FRAME_MS = 20;

export interface CallOptions {
  script: ScriptLines;
  profile: CallerProfile;
  media: MediaBridge;
  voice: VoiceProvider;
  limitMs?: number;
  endpointingCfg?: Endpointing;
  /** Injectable clock, so the turn loop is testable without waiting in real time. */
  now?: () => number;
}

/**
 * One call. Bridges telephony media and the voice model, owns turn-taking when
 * we are not delegating it, detects corrections, holds the time courtesy, and
 * records the metrics the stress test reports on.
 */
export async function runCall(opts: CallOptions): Promise<CallMetrics> {
  const ep = opts.endpointingCfg ?? endpointing();
  const now = opts.now ?? Date.now;
  const metrics = new CallMetrics();
  const corrections = new CorrectionBuffer();
  const timekeeper = new Timekeeper(opts.script, { limitMs: opts.limitMs ?? 60 * 60_000 });

  const baseInstructions = buildInstructions(opts.script, opts.profile);

  let agentSpeaking = false;
  let userSpeaking = false;
  let speechStartedAt = 0;
  let lastVoiceAt = 0;
  let partial = '';
  let lastAgentTurnId: string | undefined;
  let turnIndex = 0;
  let pendingTurn = false;
  let closed = false;

  log('call.start', {
    endpointing: { sensitivity: ep.sensitivity, base: ep.baseSilenceMs, trailing: ep.trailingClauseMs, short: ep.shortAnswerMs, max: ep.maxWaitMs },
    turnTaking: config.turnTaking,
    variants: config.variants,
  });

  const session: VoiceSession = await opts.voice.connect(
    {
      instructions: baseInstructions,
      language: opts.profile.language ?? config.language,
      voice: config.xai.voice,
      input: { kind: 'pcmu', rate: 8000 },
      output: { kind: 'pcmu', rate: 8000 },
      providerTurnDetection:
        config.turnTaking === 'provider'
          ? { silenceMs: ep.baseSilenceMs, threshold: 0.85, prefixPaddingMs: 333 }
          : false,
    },
    {
      onAudio: (chunk) => {
        metrics.firstAudio();
        opts.media.send(chunk);
      },
      onAgentSpeechStarted: () => {
        agentSpeaking = true;
        // If we started while they were still going, that is our failure.
        if (userSpeaking && partial.trim()) {
          corrections.add(agentCutUserOff());
          applyCorrections();
        }
      },
      onAgentSpeechDone: () => {
        agentSpeaking = false;
      },
      onAgentTranscript: (text, final) => {
        if (!final) return;
        lastAgentTurnId = matchTurnId(text, opts.script);
        if (lastAgentTurnId && HARD_TURNS.has(lastAgentTurnId)) timekeeper.markSensitive();
      },
      onUserTranscript: (text, final) => {
        if (!final) {
          partial = text;
          return;
        }
        partial = '';
        const c = detectCorrectionPhrase(text);
        if (c) {
          corrections.add(c);
          metrics.corrections.push(c.kind);
          applyCorrections();
        }
      },
      onError: (e) => log('voice.error', { message: e.message }),
      onClosed: () => {
        closed = true;
      },
    },
  );

  function applyCorrections(): void {
    session.updateInstructions(baseInstructions + corrections.render());
    log('call.correction', { kinds: corrections.all.map((c) => c.kind) });
  }

  // ---- inbound audio: our own turn detection -------------------------------
  opts.media.onAudio((chunk) => {
    session.sendAudio(chunk);
    if (config.turnTaking === 'provider') return;

    const t = now();
    const loud = rms(chunk) >= SPEECH_RMS;

    if (loud) {
      lastVoiceAt = t;
      if (!userSpeaking) {
        userSpeaking = true;
        speechStartedAt = t;
        pendingTurn = true;
      }
      // Speaking while the agent speaks: backchannel or a real barge-in?
      if (agentSpeaking) {
        const overlapMs = t - speechStartedAt;
        const verdict = classifyOverlap(partial, overlapMs, ep.backchannelMaxMs);
        if (verdict.type === 'backchannel') {
          metrics.backchannelsIgnored++;
        } else {
          metrics.bargeIns++;
          corrections.add(verdict.correction);
          metrics.corrections.push(verdict.correction.kind);
          session.cancel();
          applyCorrections();
        }
      }
      return;
    }

    if (!userSpeaking || !pendingTurn) return;

    const silenceMs = t - lastVoiceAt;
    if (silenceMs < FRAME_MS) return;

    const hard = !!lastAgentTurnId && HARD_TURNS.has(lastAgentTurnId);
    const budget = silenceBudgetMs(
      { partial, lastAgentTurnId, lastTurnWasHard: hard, userPatienceOffsetMs: opts.profile.patienceOffsetMs },
      ep,
    );

    if (silenceMs < budget) return;

    // Backchannel-only "turn" is not a turn.
    if (isBackchannel(partial)) {
      metrics.backchannelsIgnored++;
      userSpeaking = false;
      pendingTurn = false;
      return;
    }

    userSpeaking = false;
    pendingTurn = false;
    metrics.turns.push({
      index: turnIndex++,
      endpointLatencyMs: silenceMs,
      budgetMs: budget,
      reason: hard ? 'hard-turn' : partial.trim().split(/\s+/).length <= 2 ? 'short-answer' : 'base',
      hardTurn: hard,
    });
    log('turn.end', { index: turnIndex - 1, waitedMs: silenceMs, budgetMs: budget, hard });
    session.respond();
  });

  // ---- time courtesy -------------------------------------------------------
  const timer = setInterval(() => {
    if (closed || timekeeper.finished) return;
    const atBreak = !agentSpeaking && !userSpeaking;
    const due = timekeeper.due(metrics.durationMs, atBreak);
    if (due && due.text) {
      log('call.time_mention', { mention: due.mention });
      session.updateInstructions(
        `${baseInstructions}${corrections.render()}\n\nSay exactly this once, now, as a passing courtesy, then drop the subject entirely: "${due.text}"`,
      );
      session.respond();
    }
  }, 5000);

  await new Promise<void>((resolve) => {
    opts.media.onHangup(() => resolve());
  });

  clearInterval(timer);
  metrics.endedAt = Date.now();
  session.close();
  log('call.end', metrics.summary());
  return metrics;
}

/** Best-effort map from what the agent said back to the script id it came from. */
function matchTurnId(spoken: string, script: ScriptLines): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const target = norm(spoken);
  if (!target) return undefined;
  for (const [id, text] of script) {
    const t = norm(text);
    if (t && (target.includes(t.slice(0, 40)) || t.includes(target.slice(0, 40)))) return id;
  }
  return undefined;
}
