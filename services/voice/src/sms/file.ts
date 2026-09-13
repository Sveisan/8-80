import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from '../config.ts';
import { log } from '../log.ts';
import type { Sms } from './types.ts';

/** Appends to a file instead of sending, for development. Under runs/, gitignored. */
export class FileSms implements Sms {
  private readonly path: string;

  constructor(dir = resolve(repoRoot, 'runs', 'sms')) {
    mkdirSync(dir, { recursive: true });
    this.path = resolve(dir, 'outbox.txt');
  }

  async send(to: string, body: string): Promise<void> {
    appendFileSync(this.path, `${new Date().toISOString()}\t${to}\t${body}\n`);
    log('sms.written', { path: this.path });
  }
}
