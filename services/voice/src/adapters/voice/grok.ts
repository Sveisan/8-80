import { WebSocket } from 'ws';
import { config } from '../../config.ts';
import { log } from '../../log.ts';
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
        audio: { input: { format: fmt(cfg.input) }, output: { format: fmt(cfg.output) } },
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
          readyFallback ??= setTimeout(ready, 1500).unref();
          break;

        case 'session.updated':
          ready();
          break;

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
          if (typeof d === 'string') events.onAudio?.(Buffer.from(d, 'base64'));
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

        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.input_audio_transcription.done':
          events.onUserTranscript?.(String(ev['transcript'] ?? ''), true);
          break;

        case 'error':
          events.onError?.(new Error(JSON.stringify(ev['error'] ?? ev)));
          break;

        default:
          break;
      }
    });

    ws.on('close', (code) => {
      clearTimeout(readyFallback);
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
