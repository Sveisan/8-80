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

test('a call that never left the building still gets a text, and not a lie', async () => {
  // From where they are sitting the weekly call simply did not happen, and a
  // silence is how somebody decides a thing is broken and stops expecting it.
  const { loadScript } = await import('../src/script.ts');
  const script = loadScript();
  const missed = script.get('sms.missed') ?? '';
  const failed = script.get('sms.failed') ?? '';
  assert.ok(failed, 'sms.failed is in SCRIPT.md');
  assert.ok(/rang/i.test(missed), 'the missed-call text says their phone rang');
  assert.ok(!/rang just now/i.test(failed), 'and this one must not, because it did not');
  assert.ok(failed.includes('{{link}}'), 'it carries a way to move the call');
  assert.ok(/my end/i.test(failed), 'and says whose fault it was');
});
