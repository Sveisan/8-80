import { milestone } from '../journey/measure.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { billingHome, composeTrialEnded } from './notice.ts';
import { enqueue, dispatchMessage } from '../messages/outbox.ts';
import { decrypt } from '../store/crypto.ts';

/** Trial closure and its notice commit together. Missing addresses remain visible failures. */
export async function expireTrials(deps: LoopDeps, now = new Date()): Promise<number> {
  const ids: string[] = [];
  const count = await deps.store.raw.begin(async tx => {
    const rows = await tx<{ phone_hash: string; email_enc: string | null; trial_ends_at: Date }[]>`update callers set billing_status = 'ended', updated_at = ${now}
      where billing_status = 'trialing' and trial_ends_at <= ${now} returning phone_hash, email_enc, trial_ends_at`;
    for (const row of rows) {
      await milestone(tx, row.phone_hash, 'trial_ended', `${row.phone_hash}:${row.trial_ends_at.toISOString()}`, now);
      const letter = composeTrialEnded(deps.script, billingHome());
      if (!letter) throw new Error('Missing trial notice template');
      const id = await enqueue(tx, { eventKey: `trial:${row.phone_hash}:${row.trial_ends_at.toISOString()}`, phoneHash: row.phone_hash, channel: 'email', kind: 'trial',
        to: row.email_enc ? decrypt(row.email_enc) : '', body: letter }, now);
      if (!row.email_enc) await tx`update message_outbox set status = 'failed', reason = 'missing_address' where id = ${id}`;
      ids.push(id);
    }
    return rows.length;
  });
  for (const id of ids) await dispatchMessage(deps, id, now);
  return count;
}
