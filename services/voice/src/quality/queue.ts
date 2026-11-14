import type { Recap } from '../recap/compose.ts';
import type { Database } from '../store/transaction.ts';
import { transaction } from '../store/transaction.ts';
import { encrypt } from '../store/crypto.ts';
import { log } from '../log.ts';
import { workerConfig, type WorkerConfig } from './worker.ts';

/** Save only conversational paragraphs, before the send outbox clears its copy.
 * No model I/O. A savepoint prevents an optional queue failure aborting settlement.
 * The worker clears this encrypted snippet immediately after its single attempt. */
export async function queueQualityReview(sql: Database, attemptId: string, phoneHash: string, recap: Recap,
  now = new Date(), settings: WorkerConfig = workerConfig()): Promise<void> {
  if (!settings.enabled || !settings.startedAt || +now < +settings.startedAt) return;
  try {
    const text = recap.parts.filter(p => ['lead', 'body'].includes(p.role)).map(p => p.text).join('\n\n').trim();
    const encrypted = text ? encrypt(text) : null;
    await transaction(sql, async tx => {
      await tx`insert into jev_quality_reviews (attempt_id, phone_hash, state, recap_enc, started_at, expires_at)
        values (${attemptId}, ${phoneHash}, 'queued', ${encrypted}, ${now}, ${new Date(+now + 14 * 86_400_000)})
        on conflict (attempt_id) do nothing`;
    });
  } catch { log('jev_quality.queue_unavailable', {}); }
}
