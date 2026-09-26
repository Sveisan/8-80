import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../config.ts';
import { log } from '../log.ts';
import { decrypt, encrypt, hasKey } from './crypto.ts';
import type { CallerRecord, CallOutcome, Store } from './types.ts';

/**
 * A caller's memory, on disk, for development.
 *
 * Postgres is the decision and this is not it — but the interface is, and
 * everything above this file is written against `Store`. Swapping in Drizzle is
 * one implementation, not a rewrite of the call loop, and until the Norwegian
 * box is reachable this keeps the week-to-week behaviour testable rather than
 * hypothetical.
 *
 * The file name is a hash of the number, and what they said is encrypted with
 * the same application-layer scheme Postgres will use.
 */
export class FileStore implements Store {
  private readonly dir: string;

  constructor(dir = resolve(repoRoot, 'runs', 'store')) {
    this.dir = dir;
  }

  private path(phone: string): string {
    return resolve(this.dir, `${createHash('sha256').update(phone).digest('hex').slice(0, 32)}.json`);
  }

  async load(phone: string): Promise<CallerRecord> {
    try {
      const raw = JSON.parse(readFileSync(this.path(phone), 'utf8')) as Record<string, unknown>;
      const sealed = raw['lastCommitment'];
      return {
        phone,
        name: raw['name'] as string | undefined,
        language: raw['language'] as string | undefined,
        voice: raw['voice'] as string | undefined,
        callNumber: Number(raw['callNumber'] ?? 1),
        lastCommitment: typeof sealed === 'string' && sealed ? decrypt(sealed) : undefined,
        lastCommitmentDay: raw['lastCommitmentDay'] as string | undefined,
        consecutiveUndone: Number(raw['consecutiveUndone'] ?? 0),
        weeksDone: Number(raw['weeksDone'] ?? 0),
        weeksPartly: Number(raw['weeksPartly'] ?? 0),
        weeksUndone: Number(raw['weeksUndone'] ?? 0),
        patienceOffsetMs: raw['patienceOffsetMs'] as number | undefined,
        eight: open(raw['eight']),
        eighty: open(raw['eighty']),
        belief: open(raw['belief']),
      };
    } catch {
      // No record is not an error: it is the first call.
      return { phone, callNumber: 1, consecutiveUndone: 0 };
    }
  }

  async record(phone: string, outcome: CallOutcome): Promise<void> {
    const before = await this.load(phone);
    // A call that reached no commitment does not overwrite the last one: they
    // are still on the hook for what they said the week before.
    const commitment = outcome.commitment ?? before.lastCommitment;
    const eight = outcome.eight ?? before.eight;
    const eighty = outcome.eighty ?? before.eighty;
    const belief = outcome.belief ?? before.belief;
    if ((commitment || eight || eighty || belief) && !hasKey()) {
      log('store.not_written', { reason: 'DATA_ENCRYPTION_KEY is unset, and what they said is not going to disk in the clear' });
      return;
    }

    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      this.path(phone),
      JSON.stringify(
        {
          callNumber: before.callNumber + 1,
          name: before.name,
          language: before.language,
          voice: before.voice,
          lastCommitment: commitment ? encrypt(commitment) : undefined,
          lastCommitmentDay: outcome.day ?? before.lastCommitmentDay,
          // A week not established leaves every count where it was.
          consecutiveUndone:
            outcome.lastWeek === 'undone' ? before.consecutiveUndone + 1 : outcome.lastWeek ? 0 : before.consecutiveUndone,
          weeksDone: (before.weeksDone ?? 0) + (outcome.lastWeek === 'done' ? 1 : 0),
          weeksPartly: (before.weeksPartly ?? 0) + (outcome.lastWeek === 'partly' ? 1 : 0),
          weeksUndone: (before.weeksUndone ?? 0) + (outcome.lastWeek === 'undone' ? 1 : 0),
          patienceOffsetMs: before.patienceOffsetMs,
          eight: eight ? encrypt(eight) : undefined,
          eighty: eighty ? encrypt(eighty) : undefined,
          belief: belief ? encrypt(belief) : undefined,
          lastCallAt: outcome.at,
        },
        null,
        2,
      ),
    );
    log('store.recorded', { callNumber: before.callNumber + 1, commitment: commitment ? 'set' : 'none' });
  }
}

/** A sealed field, or nothing. */
function open(sealed: unknown): string | undefined {
  return typeof sealed === 'string' && sealed ? decrypt(sealed) : undefined;
}
