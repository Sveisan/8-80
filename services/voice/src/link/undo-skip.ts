import type { SkipUndo } from '../schedule/scheduler.ts';
import { decrypt, encrypt } from '../store/crypto.ts';

/** An account-bound receipt. The scheduler checks its revision and availability on use. */
export function skipReceipt(phoneHash: string, undo: SkipUndo): string {
  return encrypt(JSON.stringify({ purpose: 'weekly-skip-undo', phoneHash, ...undo }));
}

export function readSkipReceipt(token: string | null, phoneHash: string): SkipUndo | undefined {
  if (!token || token.length > 1200) return undefined;
  try {
    const receipt = JSON.parse(decrypt(token));
    if (receipt?.purpose !== 'weekly-skip-undo' || receipt.phoneHash !== phoneHash ||
        typeof receipt.skippedAt !== 'string' || typeof receipt.replacementAt !== 'string' ||
        typeof receipt.revision !== 'string' || (receipt.cycle !== null && typeof receipt.cycle !== 'string')) return undefined;
    const skippedAt = new Date(receipt.skippedAt);
    const replacementAt = new Date(receipt.replacementAt);
    if (!Number.isFinite(+skippedAt) || !Number.isFinite(+replacementAt) || replacementAt <= skippedAt) return undefined;
    return { skippedAt, replacementAt, cycle: receipt.cycle, revision: receipt.revision };
  } catch { return undefined; }
}
