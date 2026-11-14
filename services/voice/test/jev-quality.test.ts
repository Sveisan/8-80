import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { reviewWithJev, JEV_MODEL, type JevReviewInput } from '../src/quality/jev.ts';
const privateText = 'fictional-private-wording';
const input: JevReviewInput = {
  conversation: [{ speaker: 'agent', text: 'What was useful?' }, { speaker: 'caller', text: privateText }],
  candidateRecap: 'A fictional recap.',
};
const reply = (a = 0.7, b = 0.3) => ({ model: JEV_MODEL, answers: {
  repeated_question: { type: 'noul', noul: a }, unsupported_recap: { type: 'noul', noul: b },
} });
const respond = (body: unknown, status = 200): typeof fetch => async () => new Response(JSON.stringify(body), { status });
const options = { enabled: true, apiKey: 'fictional-key' };
test('default and missing key do not contact a provider', async () => {
  const fetcher: typeof fetch = async () => { assert.fail('No request should happen.'); };
  assert.equal((await reviewWithJev(input, { fetcher })).status, 'disabled');
  assert.deepEqual(await reviewWithJev(input, { enabled: true, fetcher }), {
    advisoryOnly: true, policy: { clearMax: 0.3, flagMin: 0.7 }, status: 'unavailable', reason: 'missing_key',
  });
});
test('sends only the benchmark state to the fixed endpoint and requires the pinned model', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init?.redirect, 'error');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body.state).sort(), ['candidate_recap', 'conversation', 'trusted_context']);
    assert.deepEqual(body.state.conversation, input.conversation);
    assert.equal(body.model, JEV_MODEL);
    assert.equal(JSON.stringify(body).includes('do-not-send-id'), false);
    return new Response(JSON.stringify(reply()));
  };
  const decorated = { ...input, providerCallId: 'do-not-send-id', labels: { secret: true } };
  const result = await reviewWithJev(decorated, { ...options, fetcher });
  assert.equal(calls, 1); assert.equal(result.status, 'reviewed');
  if (result.status === 'reviewed') {
    assert.equal(result.repeatedQuestion.state, 'flag');
    assert.equal(result.unsupportedRecap.state, 'clear');
  }
});
test('uncertainty is retained on both sides of the decision boundaries', async () => {
  const result = await reviewWithJev(input, { ...options, fetcher: respond(reply(0.699, 0.301)) });
  assert.equal(result.status, 'reviewed');
  if (result.status === 'reviewed') {
    assert.equal(result.repeatedQuestion.state, 'uncertain');
    assert.equal(result.unsupportedRecap.state, 'uncertain');
  }
});
test('malformed scores, missing answers, wrong model and HTTP errors never become clear', async () => {
  for (const body of [reply(-0.1), reply(1.1), { model: JEV_MODEL, answers: {} },
    { ...reply(), model: 'jev-latest' },
    { ...reply(), answers: { ...reply().answers, repeated_question: { type: 'noul', noul: true } } }]) {
    const result = await reviewWithJev(input, { ...options, fetcher: respond(body) });
    assert.equal(result.status, 'unavailable');
    assert.ok(!JSON.stringify(result).includes('clear"'));
  }
  const failed = await reviewWithJev(input, { ...options, fetcher: respond({ privateText }, 429) });
  assert.equal(failed.status, 'unavailable');
  assert.ok(!JSON.stringify(failed).includes(privateText));
});
test('deadline bounds both a stalled request and a stalled body without retries', async () => {
  let requests = 0;
  const hanging: typeof fetch = async () => { requests++; return new Promise(() => {}); };
  const request = await reviewWithJev(input, { ...options, timeoutMs: 15, fetcher: hanging });
  assert.equal(request.status, 'unavailable');
  if (request.status === 'unavailable') assert.equal(request.reason, 'timeout');
  assert.equal(requests, 1);
  const body = await reviewWithJev(input, { ...options, timeoutMs: 15,
    fetcher: async () => new Response(new ReadableStream({ start() {} })) });
  assert.equal(body.status, 'unavailable');
  if (body.status === 'unavailable') assert.equal(body.reason, 'timeout');
});
test('oversized input is refused without truncation or a request; oversized response is unavailable', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response('x'.repeat(20_000)); };
  const huge = await reviewWithJev({ ...input, candidateRecap: 'ø'.repeat(40_000) }, { ...options, fetcher });
  assert.equal(huge.status, 'unavailable');
  if (huge.status === 'unavailable') assert.equal(huge.reason, 'payload_too_large');
  assert.equal(calls, 0);
  const tooLarge = await reviewWithJev(input, { ...options, fetcher });
  assert.equal(tooLarge.status, 'unavailable');
  if (tooLarge.status === 'unavailable') assert.equal(tooLarge.reason, 'response_too_large');
});
test('CLI preserves local checks when Jev is disabled or lacks credentials, without raw output', () => {
  const dir = mkdtempSync(join(tmpdir(), '8and80-jev-'));
  const file = join(dir, 'private-packet.json');
  const cli = resolve(import.meta.dirname, '../src/quality/jev-cli.ts');
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    encoding: 'utf8', env: { ...process.env, TYPESAFE_API_KEY: '' },
  });
  try {
    writeFileSync(file, JSON.stringify(input));
    for (const args of [['--file', file], ['--file', file, '--send-to-jev', '--key-file', join(dir, 'not-present.env')]]) {
      const result = run(args); assert.equal(result.status, 0, result.stderr);
      const report = JSON.parse(result.stdout); assert.ok(report.report.structural);
      assert.equal(report.jev.status, args.includes('--send-to-jev') ? 'unavailable' : 'disabled');
      assert.ok(!result.stdout.includes(privateText));
      assert.ok(!result.stdout.includes(input.candidateRecap));
      assert.ok(!result.stdout.includes(file));
    }
    writeFileSync(file, privateText);
    const malformed = run(['--file', file]); assert.equal(malformed.status, 1);
    assert.ok(!malformed.stderr.includes(privateText));
    assert.ok(!malformed.stderr.includes(file));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
