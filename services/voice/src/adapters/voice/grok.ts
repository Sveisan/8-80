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
        case 'session.updated':
          events.onReady?.();
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

    ws.on('close', (code) => events.onClosed?.(code));
    ws.on('error', (e) => events.onError?.(e instanceof Error ? e : new Error(String(e))));

    log('voice.connected', { provider: 'grok', model: config.xai.model, turnTaking: config.turnTaking });

    return {
      sendAudio(chunk) {
        send({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') });
      },
      respond() {
        send({ type: 'input_audio_buffer.commit' });
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
