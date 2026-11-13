import { execFileSync } from 'node:child_process';
import { repoRoot } from '../config.ts';

/** Captured once per web process, not supplied by a browser or a mutable env stamp. */
export const runningRelease = (() => {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:repoRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    return /^[a-f0-9]{40}$/.test(sha) ? sha : '';
  } catch { return ''; }
})();
