import { EventEmitter } from 'node:events';
import type { VoiceEvents, VoiceProvider, VoiceSession, VoiceSessionConfig } from './types.ts';

/**
 * A provider that speaks no words and needs no network. It exists so the whole
 * call loop — endpointing, correction detection, the timekeeper, metrics — can
 * be exercised and tested without a phone, an API key, or a vendor.
 */
export class MockVoiceProvider implements VoiceProvider {
  readonly name = 'mock';
  readonly bus = new EventEmitter();
  instructions = '';
  cancels = 0;
  responses = 0;

  async connect(cfg: VoiceSessionConfig, events: VoiceEvents): Promise<VoiceSession> {
    this.instructions = cfg.instructions;
    queueMicrotask(() => events.onReady?.());
    return {
      sendAudio: () => {},
      respond: () => {
        this.responses++;
        events.onAgentSpeechStarted?.(Date.now());
        events.onAudio?.(Buffer.alloc(160, 0xff));
        events.onAgentSpeechDone?.(Date.now());
      },
      cancel: () => {
        this.cancels++;
      },
      updateInstructions: (i) => {
        this.instructions = i;
      },
      clearInput: () => {},
      close: () => events.onClosed?.(1000),
    };
  }
}
