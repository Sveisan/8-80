import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from './helpers/db.ts';
import { phoneKey } from '../src/store/postgres.ts';
import { encrypt, decrypt } from '../src/store/crypto.ts';
import { queueQualityReview } from '../src/quality/queue.ts';
import { reviewCompletedCalls, pruneQualityReviews, workerConfig, type WorkerConfig } from '../src/quality/worker.ts';
import { reviewWithJev, JEV_MODEL } from '../src/quality/jev.ts';
const now = new Date('2026-11-14T12:00:00Z');
const settings: WorkerConfig = { enabled: true, apiKey: 'fictional-key', startedAt: new Date(+now - 3_600_000) };
const recap = { subject: 'Fictional', body: 'Fictional', parts: [
  { role: 'lead' as const, text: 'You chose a short walk.' },
  { role: 'quiet' as const, text: 'Private billing or next appointment; not a conversation claim.' },
] };
test('worker requires explicit activation and a valid cutover timestamp', () => {
  assert.equal(workerConfig({ TYPESAFE_API_KEY: 'test-only' }).enabled, false);
  assert.equal(workerConfig({ JEV_REVIEW_ENABLED: '1', JEV_REVIEW_STARTED_AT: 'not-a-date' }).startedAt, undefined);
  assert.equal(workerConfig({ JEV_REVIEW_ENABLED: 'true' }).enabled, false);
});
test('without a retained recap, only repetition is requested; recap never becomes clear', async () => {
  const answer = await reviewWithJev({ conversation: [{ speaker: 'caller', text: 'A walk.' }] }, {
    enabled: true, apiKey: 'fictional', fetcher: async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(request.questions), ['repeated_question']);
      assert.ok(!('candidate_recap' in request.state));
      return new Response(JSON.stringify({ model: JEV_MODEL, answers: { repeated_question: { type: 'noul', noul: 0.5 } } }));
    },
  });
  assert.equal(answer.status, 'reviewed');
  if (answer.status === 'reviewed') assert.deepEqual(answer.unsupportedRecap, { state: 'unavailable', reason: 'no_recap' });
});

const opened = await openTestDb('jev_worker');
test('completed-call queue is durable, isolated, one-shot, private, bounded and deletable', { skip: typeof opened === 'string' ? opened : false }, async () => {
  const db = opened as Exclude<typeof opened, string>;
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 13).toString('base64');
  const phone = '+4790000668', hash = phoneKey(phone);
  let requests = 0;
  const reviewer: typeof reviewWithJev = async (input, options) => {
    requests++;
    assert.equal(options?.enabled, true);
    assert.equal(input.candidateRecap, 'You chose a short walk.');
    return { advisoryOnly: true, policy: { clearMax: 0.3, flagMin: 0.7 }, status: 'reviewed', model: JEV_MODEL,
      repeatedQuestion: { state: 'uncertain', probability: 0.5 }, unsupportedRecap: { state: 'flag', probability: 0.9 } };
  };
  async function call(id: string, ended = new Date(+now - 60_000), status = 'completed') {
    await db.sql`insert into call_attempts (id, phone_hash, scheduled_for, status, provider_call_id, ended_at)
      values (${id}, ${hash}, ${ended}, ${status}, ${'conv-' + id}, ${ended})`;
    const body = { conversation_id: 'conv-' + id, duration_ms: 1000,
      messages: [{ role: 'agent', content: 'What did you choose?' }, { role: 'caller', content: 'fictional-private-sentence' }] };
    await db.sql`insert into webhook_deliveries (id, event, conversation_id, body_enc) values
      (${'delivery-' + id}, 'conversation.completed', ${'conv-' + id}, ${encrypt(JSON.stringify(body))})`;
  }
  try {
    await db.store.upsertProfile(phone, { name: 'Synthetic' });
    await call('valid'); await call('before-cutover', new Date(+now - 2 * 3_600_000)); await call('not-completed', undefined, 'silent');
    await queueQualityReview(db.sql, 'valid', hash, recap, now, settings);
    const [queued] = await db.sql`select * from jev_quality_reviews where attempt_id='valid'`;
    assert.equal(queued!['state'], 'queued');
    assert.equal(decrypt(queued!['recap_enc']), 'You chose a short walk.');
    // Two workers select simultaneously, but only one may claim a given call.
    await Promise.all([reviewCompletedCalls(db.sql, settings, now, reviewer), reviewCompletedCalls(db.sql, settings, now, reviewer)]);
    assert.equal(requests, 1);
    const [done] = await db.sql`select * from jev_quality_reviews where attempt_id='valid'`;
    assert.equal(done!['state'], 'reviewed'); assert.equal(done!['recap_enc'], null);
    assert.ok(!done!['report'].includes('fictional-private-sentence'));
    assert.ok(!done!['report'].includes('You chose a short walk.'));
    assert.equal(JSON.parse(done!['report']).jev.repeatedQuestion.state, 'uncertain');
    await reviewCompletedCalls(db.sql, settings, now, reviewer); assert.equal(requests, 1);
    // A broken optional enqueue rolls back only its savepoint, never the caller's transaction.
    await db.sql.begin(async tx => {
      await queueQualityReview(tx, 'does-not-exist', hash, recap, now, settings);
      const [ok] = await tx`select 1 as n`; assert.equal(ok!['n'], 1);
    });
    await call('interrupted');
    await db.sql`insert into jev_quality_reviews (attempt_id,phone_hash,state,started_at,expires_at,recap_enc)
      values ('interrupted',${hash},'running',${new Date(+now - 360_000)},${new Date(+now + 86_400_000)},${encrypt('private queued text')})`;
    await reviewCompletedCalls(db.sql, settings, now, reviewer);
    assert.equal(requests, 1);
    const [stale] = await db.sql`select * from jev_quality_reviews where attempt_id='interrupted'`;
    assert.equal(stale!['state'], 'unavailable'); assert.equal(stale!['recap_enc'], null);
    // Retention runs even with model review disabled; never re-export expired calls.
    await db.sql`update jev_quality_reviews set expires_at=${new Date(+now - 1)} where attempt_id='interrupted'`;
    assert.equal(await pruneQualityReviews(db.sql, now), 1);
    await db.sql`delete from call_attempts where id='valid'`;
    assert.equal((await db.sql`select * from jev_quality_reviews where attempt_id='valid'`).length, 0);
    assert.equal((await db.sql`select status from call_attempts where id='before-cutover'`)[0]!['status'], 'completed');
    const before = requests;
    await reviewCompletedCalls(db.sql, { ...settings, enabled: false }, now, reviewer); assert.equal(requests, before);
  } finally { await db.close(); }
});
