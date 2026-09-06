import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, endpointing, repoRoot, type Endpointing } from '../config.ts';
import { log } from '../log.ts';
import { HARD_TURNS, type ScriptLines } from '../script.ts';
import { buildInstructions, resolveVoice, type CallerProfile } from '../prompt.ts';
import { CallMetrics } from '../metrics.ts';
import { rms } from '../audio/mulaw.ts';
import { NoiseFloor } from '../audio/floor.ts';
import { toneFrames } from '../audio/tone.ts';
import { mulawToWav } from '../audio/wav.ts';
import { isBackchannel } from '../turn/endpointer.ts';
import { TurnDetector } from '../turn/detector.ts';
import { TraceRecorder } from '../turn/trace.ts';
import { FalseCutEstimator } from './falsecut.ts';
import { CorrectionBuffer, agentCutUserOff, classifyOverlap, detectCorrectionPhrase } from './corrections.ts';
import { extractCommitment } from './commitment.ts';
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
  // Measured from the caller's own line, so a café is not mistaken for someone
  // who never stops talking.
  const floor = new NoiseFloor(SPEECH_RMS);
  const falseCut = new FalseCutEstimator();
  const trace = new TraceRecorder();

  let agentSpeaking = false;
  /**
   * Is the caller currently hearing the agent?
   *
   * Not the same question as "has the model finished generating". A thirty
   * second answer is produced in about two seconds and then plays for thirty,
   * so the model's own done-event fires while the caller is still most of a
   * minute from the end. Judging interruptions by the model's state means a
   * caller who talks over the agent is recorded as talking to silence — which
   * is exactly what a caller reported: it "completed its whole phrase without
   * being bothered by me".
   */
  const agentAudible = () => agentSpeaking || opts.media.pendingMs() > 0;
  /**
   * What the caller has said since our last turn end — the whole turn, not the
   * latest fragment of it.
   *
   * A turn can contain several completed utterances: the provider commits on
   * its own voice activity, which fires far more often than a turn ends. The
   * first version cleared this on every completed transcript, so by the time a
   * budget was computed there were no words left to read and every turn in a
   * live call fell to "nothing said yet" — 5.9 seconds, every time, which is
   * exactly what the caller reported as the latency.
   */
  let turnText = '';
  let livePartial = '';
  const spokenSoFar = () => `${turnText} ${livePartial}`.trim();
  const clearTurnText = () => {
    turnText = '';
    livePartial = '';
  };
  let lastAgentTurnId: string | undefined;
  let turnIndex = 0;
  let overlapHandled = false;
  /** When this burst of caller speech began, and whether they could hear us then. */
  let speechStartedAt = 0;
  let spokeOverAgent = false;
  /** How much of our own audio they still had left to hear when they spoke. */
  let pendingAtSpeechStart = 0;
  /** A short sound we treated as listening. If nothing follows, we were wrong. */
  let backchannelAt = 0;
  let greeted = false;
  /**
   * Whether a transcript of the caller has ever arrived. Until one does, the
   * endpointer is reading energy alone and must not pretend otherwise.
   */
  let sawTranscript = false;
  const capture = config.captureCallAudio();
  const captured: Buffer[] = [];
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
      ...(config.xai.outputFormat === 'pcm16' ? { preferProviderOutput: { kind: 'pcm16' as const, rate: 24000 as const } } : {}),
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
        // Kept in the caller's own format, so the recording is the audio the
        // carrier was given — not a re-rendering of what we hoped it was.
        if (capture && captured.length < 4000) captured.push(chunk);
        opts.media.send(chunk);
      },
      onAgentSpeechStarted: () => {
        agentSpeaking = true;
        // If we started while they were still going, that is our failure.
        if (detector.isSpeaking && spokenSoFar()) {
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
        // The read-back is the one moment the commitment is stated plainly, in
        // their words, by us. Taken here rather than reconstructed afterwards.
        const c = extractCommitment(text, opts.script);
        if (c) {
          metrics.commitment = c;
          log('call.commitment', { day: c.day ?? null, words: c.text.split(' ').length });
        }
        lastAgentTurnId = matchTurnId(text, opts.script);
        if (lastAgentTurnId && HARD_TURNS.has(lastAgentTurnId)) timekeeper.markSensitive();
      },
      onUserTranscript: (text, final) => {
        if (text.trim() && !sawTranscript) {
          sawTranscript = true;
          log('call.transcripts_live', {});
        }
        if (!final) {
          livePartial = text;
          return;
        }
        turnText = `${turnText} ${text}`.trim();
        livePartial = '';
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
    const loud = floor.observe(rms(chunk));
    const hard = !!lastAgentTurnId && HARD_TURNS.has(lastAgentTurnId);

    detector.setContext({
      lastTurnWasHard: hard,
      patienceOffsetMs: opts.profile.patienceOffsetMs,
      transcriptsAvailable: sawTranscript,
    });
    const ev = detector.frame(loud, spokenSoFar(), t);

    if (ev?.kind === 'speech_start') {
      overlapHandled = false;
      speechStartedAt = t;
      pendingAtSpeechStart = opts.media.pendingMs();
      spokeOverAgent = agentAudible();
      backchannelAt = 0;
      trace.speechStart(t - metrics.startedAt);
      // They started again right after we handed the turn over. We were early.
      if (falseCut.noteUserSpeech(t, spokenSoFar())) {
        metrics.falseInterruptions++;
        trace.suspectedCut(t - metrics.startedAt);
        corrections.add(agentCutUserOff());
        applyCorrections();
        log('turn.false_cut_suspected', { waited: metrics.turns.at(-1)?.endpointLatencyMs ?? null });
      }
    }

    // Speaking over the agent: a backchannel is not an interruption, and this is
    // judged once per utterance rather than once per 20ms frame.
    if (loud && agentAudible() && !overlapHandled) {
      const overlapMs = detector.speakingForMs(t);
      if (overlapMs > ep.backchannelMaxMs && !isBackchannel(spokenSoFar())) {
        overlapHandled = true;
        const verdict = classifyOverlap(spokenSoFar(), overlapMs, ep.backchannelMaxMs);
        if (verdict.type === 'interruption') {
          metrics.bargeIns++;
          corrections.add(verdict.correction);
          metrics.corrections.push(verdict.correction.kind);
          // Both, and in this order: stop the model producing more, then drop
          // what the carrier is still holding. Cancelling only the model leaves
          // the agent talking over the person who interrupted it.
          live.cancel();
          opts.media.clear();
          applyCorrections();
        }
      }
    }

    // A backchannel we misread leaves the caller waiting for an answer that is
    // never coming. Nothing about this call may end in silence: if they said
    // their short thing, we finished speaking, and neither of us has said
    // anything since, it was a turn after all.
    if (backchannelAt && !agentAudible() && !detector.isSpeaking && t - backchannelAt > 2500) {
      backchannelAt = 0;
      log('turn.backchannel_was_a_turn', {});
      live.respond();
      return;
    }

    if (ev?.kind === 'backchannel_end') {
      trace.speechEnd(ev.at - metrics.startedAt, spokenSoFar());
      metrics.backchannelsIgnored++;
      clearTurnText();
      return;
    }

    if (ev?.kind === 'turn_end') {
      // A short burst made while they could hear us is listening, not a turn.
      //
      // Judged by duration and by whether we were audible, not by the words:
      // transcription arrives a second or two late, so at the moment a 300ms
      // "mhm" has to be classified there is usually no text for it at all. The
      // behaviour was already right — the agent kept talking — but nothing
      // counted it, and answering a backchannel as though it were a turn is
      // the same mistake made audible.
      const utteranceMs = ev.at - ev.waitedMs - speechStartedAt;
      // Mid-utterance, not almost-finished. "Yes" said over the last half
      // second of a question is an answer to it; the same sound said with
      // seconds of our speech still to come is listening. Without this
      // distinction a caller answers "yes" and the line goes silent on them —
      // which is exactly what happened on the call that found it.
      const wellInsideOurTurn = spokeOverAgent && pendingAtSpeechStart > 1500;
      if (wellInsideOurTurn && utteranceMs > 0 && utteranceMs <= ep.backchannelMaxMs) {
        trace.speechEnd(ev.at - ev.waitedMs - metrics.startedAt, spokenSoFar());
        metrics.backchannelsIgnored++;
        log('turn.backchannel', { utteranceMs, pendingMs: Math.round(pendingAtSpeechStart) });
        backchannelAt = ev.at;
        clearTurnText();
        return;
      }
      // The turn ended `waitedMs` ago — that is when they actually stopped.
      trace.speechEnd(ev.at - ev.waitedMs - metrics.startedAt, spokenSoFar());
      metrics.turns.push({
        index: turnIndex++,
        endpointLatencyMs: ev.waitedMs,
        budgetMs: ev.budgetMs,
        reason: ev.reason,
        hardTurn: hard,
      });
      falseCut.noteTurnEnd(t);
      log('turn.end', {
        index: turnIndex - 1,
        waitedMs: ev.waitedMs,
        budgetMs: ev.budgetMs,
        reason: ev.reason,
        hard,
        words: spokenSoFar().split(/\s+/).filter(Boolean).length,
        // Audio still waiting to be heard when their turn ended. Large numbers
        // mean the two sides of the conversation are drifting apart.
        pendingMs: Math.round(opts.media.pendingMs()),
      });
      clearTurnText();
      live.respond();
    }
  });

  // ---- time courtesy -------------------------------------------------------
  const timer = setInterval(() => {
    if (closed || timekeeper.finished) return;
    const atBreak = !agentAudible() && !detector.isSpeaking;
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

  if (capture && captured.length) {
    const dir = resolve(repoRoot, 'runs');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `call-${new Date(metrics.startedAt).toISOString().replace(/[:.]/g, '-')}.wav`);
    writeFileSync(file, mulawToWav(Buffer.concat(captured)));
    metrics.audioFile = file;
    log('call.audio_saved', { file, chunks: captured.length });
  }
  metrics.trace = trace.build(ep.sensitivity, metrics.durationMs);
  metrics.sawTranscripts = sawTranscript;
  metrics.noiseFloor = floor.floor;
  log('call.noise', { floor: +floor.floor.toFixed(4), threshold: +floor.threshold.toFixed(4), base: SPEECH_RMS });
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
