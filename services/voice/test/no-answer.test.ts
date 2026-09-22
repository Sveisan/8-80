import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CallNotPlaced } from '../src/agent/speechify.ts';

const detail = (code: string, message: string) => JSON.stringify({ error: { code, message }, request_id: 'x' });

test('a phone that rang and was not answered is not a failure to retry', () => {
  // Speechify says "you can retry" and it is wrong for this product: retrying
  // rings somebody three times in seventy seconds from an unknown number.
  const e = new CallNotPlaced(502, detail('upstream_failure', 'the destination did not answer; you can retry.'), '/v1/agents/outbound-calls');
  assert.equal(e.rang, true);
  assert.equal(e.code, 'upstream_failure');
  assert.ok(e.message.includes('did not answer'), 'and the reason survives onto the error');
});

test('a carrier refusing the call means nobody was rung', () => {
  // The SIP 403 that cost four days. Nobody's phone made a sound, so trying
  // again in two seconds is exactly right.
  const e = new CallNotPlaced(
    400,
    detail('validation_failed', 'the outbound call could not be completed (SIP status 403) - the carrier refused the call'),
    '/v1/agents/outbound-calls',
  );
  assert.equal(e.rang, false);
});

test('every way they might say nobody picked up', () => {
  for (const said of [
    'the destination did not answer; you can retry.',
    'No answer from the destination',
    'destination busy',
    'the call was declined',
    'the number is unavailable',
    'the call timed out',
  ]) {
    assert.equal(new CallNotPlaced(502, detail('upstream_failure', said), '/p').rang, true, said);
  }
});

test('an unparseable body is never mistaken for an answered phone', () => {
  // Failing towards "nobody was rung" means a retry, which is recoverable.
  // Failing the other way would file a call as missed that never happened and
  // text somebody about a call their phone never made.
  for (const body of ['', 'not json', '<html>502 Bad Gateway</html>', '{}']) {
    const e = new CallNotPlaced(502, body, '/p');
    assert.equal(e.rang, false, body);
    assert.ok(e.message.includes('HTTP 502'));
  }
});
