import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../config.ts';
import { log } from '../log.ts';
import type { Recap } from './compose.ts';

export interface Mailer {
  send(to: string, recap: Recap): Promise<void>;
}

/**
 * Writes the email to a file instead of sending it.
 *
 * The transactional email vendor is an open decision in ARCHITECTURE.md and
 * this is not the moment to close it by accident. What matters now is that the
 * recap is composed correctly and that its contents can be read; picking a
 * vendor later is one implementation of this interface.
 *
 * Under runs/, which is gitignored, because the file contains what somebody
 * committed to and it has no business surviving in a working copy.
 */
export class FileMailer implements Mailer {
  constructor(private readonly dir = resolve(repoRoot, 'runs', 'mail')) {}

  async send(to: string, recap: Recap): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const path = resolve(this.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    writeFileSync(path, `To: ${to}\nSubject: ${recap.subject}\n\n${recap.body}\n`);
    // The address and the subject both carry the caller. Neither goes in a log.
    log('recap.written', { path });
  }
}
