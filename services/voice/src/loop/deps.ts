import type { ScriptLines } from '../script.ts';
import type { Scheduler } from '../schedule/scheduler.ts';
import type { PostgresStore } from '../store/postgres.ts';
import type { SpeechifyAgent } from '../agent/speechify.ts';
import type { Mailer } from '../recap/mailer.ts';
import type { Sms } from '../sms/types.ts';

/**
 * Everything the loop touches, passed in rather than imported.
 *
 * Postgres specifically, not the `Store` interface: the loop has a phone hash
 * and needs a number to ring, and a file store keyed on a one-way hash cannot
 * give it one. The control plane requires a database, and saying so in the type
 * is better than discovering it at four minutes past eight on a Tuesday.
 */
export interface LoopDeps {
  store: PostgresStore;
  scheduler: Scheduler;
  agent: SpeechifyAgent;
  mailer: Mailer;
  sms: Sms;
  script: ScriptLines;
}
