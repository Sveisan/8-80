import { WebSocket } from 'ws';
import { config } from '../../config.ts';
import { log } from '../../log.ts';
import { bytesToPcm16, pcm16ToMulaw, resample } from '../../audio/mulaw.ts';
import type { AudioFormat, VoiceEvents, VoiceProvider, VoiceSession, VoiceSessionConfig } from './types.ts';

/**
 * Grok Voice Think Fast 2.0, speech-to-speech.
 *
 * Wire format confirmed against two shipping integrations published this month
 * (@livekit/agents-plugin-xai 1.7.1, @mastra/voice-xai-realtime 0.2.7) rather
 * than from memory. The LiveKit plugin extends the OpenAI Realtime session
 * directly, which is the concrete basis for the claim that swapping to
 * gpt-realtime is config rather than a rewrite.
 *
 * VERIFY BEFORE FIRST LIVE CALL — see docs/VERIFY.md. The vendor documentation
 * host was unreachable from the build environment, so the details below come
 * from client libraries, not from docs.x.ai.
 *
 * Everything Grok-shaped stops in this file.
 */

function fmt(a: AudioFormat): Record<string, unknown> {
  return a.kind === 'pcmu' ? { type: 'audio/pcmu', rate: 8000 } : { type: 'audio/pcm', rate: a.rate };
}

/** The pre-GA spelling of the same thing. */
function legacyFmt(a: AudioFormat): string {
  return a.kind === 'pcmu' ? 'g711_ulaw' : `pcm16`;
}

/**
 * What the server says it will actually send, read back from its own echo of
 * the session. Absent or unrecognised means we take it at its word that our
 * request was honoured.
 */
function negotiatedOutput(session: unknown): { kind: 'pcmu' | 'pcm16'; rate: number } | undefined {
  if (typeof session !== 'object' || session === null) return undefined;
  const s = session as Record<string, unknown>;
  const legacy = s['output_audio_format'];
  const audio = s['audio'] as { output?: { format?: unknown } } | undefined;
  const f = audio?.output?.format;
  const asText = typeof legacy === 'string' ? legacy : typeof f === 'string' ? f : undefined;
  const asObj = typeof f === 'object' && f !== null ? (f as Record<string, unknown>) : undefined;
  const type = asText ?? (typeof asObj?.['type'] === 'string' ? (asObj['type'] as string) : undefined);
  if (!type) return undefined;
  if (/ulaw|pcmu/i.test(type)) return { kind: 'pcmu', rate: 8000 };
  if (/pcm/i.test(type)) {
    const rate = Number(asObj?.['rate'] ?? (/(\d{5,6})/.exec(type)?.[1] ?? 24000));
    return { kind: 'pcm16', rate: Number.isFinite(rate) && rate > 0 ? rate : 24000 };
  }
  return undefined;
}

export class GrokVoiceProvider implements VoiceProvider {
  readonly name = 'grok';

  async connect(cfg: VoiceSessionConfig, events: VoiceEvents): Promise<VoiceSession> {
    const url = `${config.xai.url}?model=${encodeURIComponent(config.xai.model)}`;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${config.xai.apiKey()}` } });

    /**
     * Grok-specific: after a cancel it may leave a response in flight and keep
     * emitting audio for it. LiveKit discards that generation explicitly. We do
     * the same, so a barge-in does not talk over the caller.
     */
    let discardUntilNextResponse = false;
    let speaking = false;

    /**
     * Ready means configured, not merely connected. `session.created` arrives
     * before our instructions are applied, and the mentor's opening line is
     * spoken the moment we report ready — so we wait for the `session.updated`
     * that acknowledges them, and only fall back to `session.created` if that
     * acknowledgement never comes.
     */
    /**
     * Set from the server's own echo of the session. Until it says otherwise we
     * assume the format we asked for, and the audio path stays a passthrough.
     */
    let outFormat: { kind: 'pcmu' | 'pcm16'; rate: number } = cfg.output.kind === 'pcmu' ? { kind: 'pcmu', rate: 8000 } : { kind: 'pcm16', rate: cfg.output.rate };
    let convertNoted = false;
    let carry: Buffer = Buffer.alloc(0);
    let audioChunks = 0;
    let audioBytes = 0;
    let userTranscripts = 0;

    /** Honour the contract: whatever arrives, the caller gets the configured format. */
    const toConfigured = (chunk: Buffer): Buffer => {
      if (outFormat.kind === cfg.output.kind && outFormat.rate === (cfg.output.kind === 'pcmu' ? 8000 : cfg.output.rate)) return chunk;
      if (outFormat.kind !== 'pcm16' || cfg.output.kind !== 'pcmu') return chunk;
      if (!convertNoted) {
        convertNoted = true;
        log('voice.transcoding', { from: `pcm16@${outFormat.rate}`, to: 'pcmu@8000', reason: 'provider ignored the requested output format' });
      }
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      carry = buf.length % 2 ? buf.subarray(buf.length - 1) : Buffer.alloc(0);
      const body = buf.length % 2 ? buf.subarray(0, buf.length - 1) : buf;
      return pcm16ToMulaw(resample(bytesToPcm16(body), outFormat.rate, 8000));
    };

    const seenUnknown = new Set<string>();
    let readyFired = false;
    let readyFallback: NodeJS.Timeout | undefined;
    const ready = () => {
      if (readyFired) return;
      readyFired = true;
      clearTimeout(readyFallback);
      events.onReady?.();
    };

    const send = (msg: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    const sessionPayload = (instructions: string) => ({
      type: 'session.update',
      session: {
        instructions,
        voice: cfg.voice,
        turn_detection: cfg.providerTurnDetection
          ? {
              type: 'server_vad',
              threshold: cfg.providerTurnDetection.threshold,
              silence_duration_ms: cfg.providerTurnDetection.silenceMs,
              prefix_padding_ms: cfg.providerTurnDetection.prefixPaddingMs,
            }
          : null,
        audio: {
          input: {
            format: fmt(cfg.input),
            // Our endpointer reads the words, not just the energy: trailing
            // conjunctions buy patience, "mhm" is not a turn. Without a
            // transcript of the caller it degrades to silence timing alone,
            // which is the one thing this product cannot run on.
            transcription: { model: config.xai.transcribeModel },
          },
          output: { format: fmt(cfg.output) },
        },
        // The same request in the older field names. Which spelling this
        // server honours decides whether audio comes back as 8 kHz mu-law or
        // as 24 kHz PCM, and a server that ignores the format silently sends
        // the latter — which is inaudible down a phone line. Asking both ways
        // costs nothing; guessing wrong costs a call.
        input_audio_format: legacyFmt(cfg.input),
        output_audio_format: legacyFmt(cfg.output),
      },
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());

      // A rejected upgrade arrives as a plain HTTP response, and its body says
      // exactly what was wrong — an unknown model, an unaccepted voice. The ws
      // library reports only the status code unless we read it, and "400" sends
      // the debugging in every direction at once.
      ws.once('unexpected-response', (_req, res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString();
        });
        res.on('end', () => {
          // xAI answers a bad key with 400, not 401, so the status alone
          // points at the wrong thing. Read the body before deciding.
          const saysKey = /api key/i.test(body);
          const hint =
            res.statusCode === 401 || saysKey
              ? ' — the API key is not accepted. Check XAI_API_KEY, and run `npm run models` to test it directly.'
              : res.statusCode === 400
                ? ` — check XAI_VOICE_MODEL (currently "${config.xai.model}") and XAI_VOICE_NAME (currently "${config.xai.voice}")`
                : '';
          reject(new Error(`xAI refused the connection: ${res.statusCode}${hint}\n      ${body.trim().slice(0, 400)}`));
        });
      });

      ws.once('error', (e) => reject(e instanceof Error ? e : new Error(String(e))));
    });

    send(sessionPayload(cfg.instructions));

    ws.on('message', (raw) => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(ev['type'] ?? '');

      switch (type) {
        case 'session.created':
        case 'session.updated': {
          const negotiated = negotiatedOutput(ev['session']);
          if (negotiated) outFormat = negotiated;
          log('voice.session', { event: type, output: `${outFormat.kind}@${outFormat.rate}`, echoed: negotiated ? 'yes' : 'no' });
          if (type === 'session.updated') ready();
          else readyFallback ??= setTimeout(ready, 1500).unref();
          break;
        }

        case 'response.created':
          discardUntilNextResponse = false;
          break;

        // Both spellings are present across current clients; accept either.
        case 'response.output_audio.delta':
        case 'response.audio.delta': {
          if (discardUntilNextResponse) break;
          if (!speaking) {
            speaking = true;
            events.onAgentSpeechStarted?.(Date.now());
          }
          const d = ev['delta'];
          if (typeof d === 'string') {
            const raw = Buffer.from(d, 'base64');
            audioChunks++;
            audioBytes += raw.length;
            events.onAudio?.(toConfigured(raw));
          }
          break;
        }

        case 'response.output_audio.done':
        case 'response.audio.done':
          if (speaking) {
            speaking = false;
            events.onAgentSpeechDone?.(Date.now());
          }
          break;

        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta':
          events.onAgentTranscript?.(String(ev['delta'] ?? ''), false);
          break;

        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          events.onAgentTranscript?.(String(ev['transcript'] ?? ''), true);
          break;

        case 'conversation.item.input_audio_transcription.delta':
          events.onUserTranscript?.(String(ev['delta'] ?? ''), false);
          break;

        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.input_audio_transcription.done':
          userTranscripts++;
          events.onUserTranscript?.(String(ev['transcript'] ?? ''), true);
          break;

        case 'error':
          events.onError?.(new Error(JSON.stringify(ev['error'] ?? ev)));
          break;

        default:
          // The event names here came from two client libraries rather than
          // from vendor documentation. An unhandled name is how audio goes
          // missing silently, so it is named once and never again.
          if (!seenUnknown.has(type)) {
            seenUnknown.add(type);
            log('voice.unhandled_event', { type });
          }
          break;
      }
    });

    ws.on('close', (code) => {
      clearTimeout(readyFallback);
      log('voice.audio_received', { chunks: audioChunks, bytes: audioBytes, format: `${outFormat.kind}@${outFormat.rate}` });
      // Zero here after a call where someone spoke means the endpointer ran
      // blind, on timing alone. Worth knowing before trusting a stress score.
      log('voice.transcripts', { user: userTranscripts });
      events.onClosed?.(code);
    });
    ws.on('error', (e) => events.onError?.(e instanceof Error ? e : new Error(String(e))));

    log('voice.connected', { provider: 'grok', model: config.xai.model, turnTaking: config.turnTaking });

    return {
      sendAudio(chunk) {
        send({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') });
      },
      respond(opts) {
        // Committing an empty buffer is an error, so the opening turn skips it.
        if (opts?.commitInput !== false) send({ type: 'input_audio_buffer.commit' });
        send({ type: 'response.create' });
      },
      cancel() {
        discardUntilNextResponse = true;
        speaking = false;
        send({ type: 'response.cancel' });
      },
      updateInstructions(instructions) {
        send(sessionPayload(instructions));
      },
      clearInput() {
        send({ type: 'input_audio_buffer.clear' });
      },
      close() {
        ws.close();
      },
    };
  }
}
