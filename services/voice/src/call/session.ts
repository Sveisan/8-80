import { config, endpointing, type Endpointing } from '../config.ts';
import { log } from '../log.ts';
import { HARD_TURNS, type ScriptLines } from '../script.ts';
import { buildInstructions, resolveVoice, type CallerProfile } from '../prompt.ts';
import { CallMetrics } from '../metrics.ts';
import { rms } from '../audio/mulaw.ts';
import { toneFrames } from '../audio/tone.ts';
import { isBackchannel } from '../turn/endpointer.ts';
import { TurnDetector } from '../turn/detector.ts';
import { TraceRecorder } from '../turn/trace.ts';
import { FalseCutEstimator } from './falsecut.ts';
import { CorrectionBuffer, agentCutUserOff, classifyOverlap, detectCorrectionPhrase } from './corrections.ts';
import { Timekeeper } from './timekeeper.ts';
import type { MediaBridge } from '../adapters/telephony/types.ts';
import type { VoiceProvider, VoiceSession } from '../adapters/voice/types.ts';

const SPEECH_RMS = Number(process.env.VAD_RMS_THRESHOLD ?? 0.035);
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

  const detector = new TurnDetector(ep);
  const falseCut = new FalseCutEstimator();
  const trace = new TraceRecorder();

  let agentSpeaking = false;
  let partial = '';
  let lastAgentTurnId: string | undefined;
  let turnIndex = 0;
  let overlapHandled = false;
  let greeted = false;
  /**
   * Whether a transcript of the caller has ever arrived. Until one does, the
   * endpointer is reading energy alone and must not pretend otherwise.
   */
  let sawTranscript = false;
  let readyBeforeConnect = false;
  let closed = false;

  log('call.start', {
    voice: resolveVoice(opts.profile),
    endpointing: { sensitivity: ep.sensitivity, base: ep.baseSilenceMs, trailing: ep.trailingClauseMs, short: ep.shortAnswerMs, max: ep.maxWaitMs },
    turnTaking: config.turnTaking,
    variants: config.variants,
  });

  // Assigned by the connect() below; the ready callback can fire before that
  // promise resolves, which is why this is not a const.
  let session: VoiceSession | undefined = undefined;

  function greet(): void {
    if (greeted || session === undefined) return;
    greeted = true;
    log('call.greeting', {});
    session.respond({ commitInput: false });
  }

  session = await opts.voice.connect(
    {
      instructions: baseInstructions,
      language: opts.profile.language ?? config.language,
      voice: resolveVoice(opts.profile),
      input: { kind: 'pcmu', rate: 8000 },
      output: { kind: 'pcmu', rate: 8000 },
      providerTurnDetection:
        config.turnTaking === 'provider'
          ? { silenceMs: ep.baseSilenceMs, threshold: 0.85, prefixPaddingMs: 333 }
          : false,
    },
    {
      onReady: () => {
        // The mentor opens the call. Without this the loop only ever responds
        // to a finished caller turn, so it connects and waits in silence while
        // the caller says hello into nothing.
        //
        // A provider can report ready before connect() has resolved, so the
        // greeting is deferred rather than reaching for a `session` that does
        // not exist yet.
        if (session === undefined) {
          readyBeforeConnect = true;
          return;
        }
        greet();
      },
      onAudio: (chunk) => {
        metrics.voiceReady = true;
        metrics.firstAudio();
        opts.media.send(chunk);
      },
      onAgentSpeechStarted: () => {
        agentSpeaking = true;
        // If we started while they were still going, that is our failure.
        if (detector.isSpeaking && partial.trim()) {
          corrections.add(agentCutUserOff());
          applyCorrections();
        }
      },
      onAgentSpeechDone: () => {
        agentSpeaking = false;
        overlapHandled = false;
      },
      onAgentTranscript: (text, final) => {
        if (!final) return;
        lastAgentTurnId = matchTurnId(text, opts.script);
        if (lastAgentTurnId && HARD_TURNS.has(lastAgentTurnId)) timekeeper.markSensitive();
      },
      onUserTranscript: (text, final) => {
        if (text.trim() && !sawTranscript) {
          sawTranscript = true;
          log('call.transcripts_live', {});
        }
        if (!final) {
          partial = text;
          return;
        }
        partial = '';
        const c = detectCorrectionPhrase(text);
        if (c) {
          corrections.add(c);
          metrics.corrections.push(c.kind);
          falseCut.noteCorrectionPhrase();
          metrics.falseInterruptions = falseCut.count;
          applyCorrections();
        }
      },
      onError: (e) => {
        metrics.voiceError = e.message;
        log('voice.error', { message: e.message });
      },
      onClosed: () => {
        closed = true;
      },
    },
  );

  const live: VoiceSession = session;

  // Before a word is said: prove the caller can hear us at all.
  const toneMs = config.playbackToneMs();
  if (toneMs > 0) {
    log('call.tone', { ms: toneMs });
    for (const frame of toneFrames(toneMs)) opts.media.send(frame);
  }

  if (readyBeforeConnect) greet();

  function applyCorrections(): void {
    if (session === undefined) return;
    session.updateInstructions(baseInstructions + corrections.render());
    log('call.correction', { kinds: corrections.all.map((c) => c.kind) });
  }

  // ---- inbound audio: our own turn detection -------------------------------
  opts.media.onAudio((chunk) => {
    live.sendAudio(chunk);
    if (config.turnTaking === 'provider') return;

    const t = now();
    const loud = rms(chunk) >= SPEECH_RMS;
    const hard = !!lastAgentTurnId && HARD_TURNS.has(lastAgentTurnId);

    detector.setContext({
      lastTurnWasHard: hard,
      patienceOffsetMs: opts.profile.patienceOffsetMs,
      transcriptsAvailable: sawTranscript,
    });
    const ev = detector.frame(loud, partial, t);

    if (ev?.kind === 'speech_start') {
      overlapHandled = false;
      trace.speechStart(t - metrics.startedAt);
      // They started again right after we handed the turn over. We were early.
      if (falseCut.noteUserSpeech(t, partial)) {
        metrics.falseInterruptions++;
        trace.suspectedCut(t - metrics.startedAt);
        corrections.add(agentCutUserOff());
        applyCorrections();
        log('turn.false_cut_suspected', { waited: metrics.turns.at(-1)?.endpointLatencyMs ?? null });
      }
    }

    // Speaking over the agent: a backchannel is not an interruption, and this is
    // judged once per utterance rather than once per 20ms frame.
    if (loud && agentSpeaking && !overlapHandled) {
      const overlapMs = detector.speakingForMs(t);
      if (overlapMs > ep.backchannelMaxMs && !isBackchannel(partial)) {
        overlapHandled = true;
        const verdict = classifyOverlap(partial, overlapMs, ep.backchannelMaxMs);
        if (verdict.type === 'interruption') {
          metrics.bargeIns++;
          corrections.add(verdict.correction);
          metrics.corrections.push(verdict.correction.kind);
          live.cancel();
          applyCorrections();
        }
      }
    }

    if (ev?.kind === 'backchannel_end') {
      trace.speechEnd(ev.at - metrics.startedAt, partial);
      metrics.backchannelsIgnored++;
      return;
    }

    if (ev?.kind === 'turn_end') {
      // The turn ended `waitedMs` ago — that is when they actually stopped.
      trace.speechEnd(ev.at - ev.waitedMs - metrics.startedAt, partial);
      metrics.turns.push({
        index: turnIndex++,
        endpointLatencyMs: ev.waitedMs,
        budgetMs: ev.budgetMs,
        reason: ev.reason,
        hardTurn: hard,
      });
      falseCut.noteTurnEnd(t);
      log('turn.end', { index: turnIndex - 1, waitedMs: ev.waitedMs, budgetMs: ev.budgetMs, reason: ev.reason, hard });
      live.respond();
    }
  });

  // ---- time courtesy -------------------------------------------------------
  const timer = setInterval(() => {
    if (closed || timekeeper.finished) return;
    const atBreak = !agentSpeaking && !detector.isSpeaking;
    const due = timekeeper.due(metrics.durationMs, atBreak);
    if (due && due.text) {
      log('call.time_mention', { mention: due.mention });
      live.updateInstructions(
        `${baseInstructions}${corrections.render()}\n\nSay exactly this once, now, as a passing courtesy, then drop the subject entirely: "${due.text}"`,
      );
      live.respond();
    }
  }, 5000);

  await new Promise<void>((resolve) => {
    opts.media.onHangup(() => resolve());
  });

  clearInterval(timer);
  metrics.endedAt = Date.now();
  metrics.trace = trace.build(ep.sensitivity, metrics.durationMs);
  metrics.sawTranscripts = sawTranscript;
  live.close();
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
