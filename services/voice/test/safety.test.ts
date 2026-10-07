import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { alertText, checkInText, replyAlertText, safetyTier } from '../src/call/safety.ts';
import { buildInstructions } from '../src/prompt.ts';
import type { Turn } from '../src/call/outcome.ts';

const script = loadScript();
const caller = (text: string): Turn => ({ speaker: 'caller', text });
const agent = (text: string): Turn => ({ speaker: 'agent', text });

test('self-harm and not wanting to be here are tier 1, in English and Norwegian', () => {
  for (const said of ['Honestly I have thought about suicide.', 'Some days I just want to end it all.', "I don't want to be here any more.", 'Jeg har tenkt på selvmord.', 'Jeg vil ikke leve.', "I've been hurting myself again."]) {
    assert.equal(safetyTier([caller(said)], script)?.tier, 1, said);
  }
});

test('the mentor saying its crisis line is tier 1 on its own', () => {
  // It says that line only when it has judged something serious — which may
  // have been said obliquely enough that no pattern here catches it.
  const f = safetyTier([caller('It is just a lot right now.'), agent(script.get('safety.ack') ?? '')], script);
  assert.equal(f?.tier, 1);
  assert.deepEqual(f?.reasons, ['mentor_acknowledged_crisis']);
});

test('abuse, violence and feeling unsafe are tier 2', () => {
  for (const said of ['He hits me when he drinks.', "I don't feel safe at home.", 'Det er vold hjemme.', 'It all feels hopeless.']) {
    assert.equal(safetyTier([caller(said)], script)?.tier, 2, said);
  }
});

test('a hard week is not a flag', () => {
  // Ordinary difficulty is most of what this call is for, and a flag holds the
  // next call; flagging it would stop the product for the people it is for.
  const turns = [caller('Rough week. Slept badly, avoided the invoices, felt rubbish about it.'), caller('I was dreading Monday.')];
  assert.equal(safetyTier(turns, script), undefined);
});

test('the mentor saying "suicide" is not the caller saying it', () => {
  assert.equal(safetyTier([agent('This is not a suicide line, but…'), caller('No, nothing like that.')], script), undefined);
});

test('the text to the operator carries nothing from the call', () => {
  for (const text of [alertText(1), alertText(2, 3)]) {
    assert.ok(!/suicid|harm|abuse|violence|\+\d/i.test(text), text);
    assert.match(text, /--review/);
  }
});

test('the prompt acknowledges in the fixed line, offers the configured numbers, and never hangs up on it', () => {
  for (const callNumber of [1, 3]) {
    const p = buildInstructions(script, { callNumber, lastCommitment: 'x' });
    assert.ok(p.includes(script.get('safety.ack') ?? '∅'), 'the line the pipeline looks for');
    assert.match(p, /116 123/);
    assert.match(p, /Never call `end_call` after something serious/);
    assert.match(p, /Do not ask assessment questions/);
  }
});

test('the check-in texts carry the numbers and survive a lock screen', () => {
  const crisis = checkInText('crisis', script) ?? '';
  const abuse = checkInText('abuse', script) ?? '';
  assert.match(crisis, /116 123/);
  assert.match(crisis, /113/);
  assert.match(abuse, /116 006/);
  for (const t of [crisis, abuse]) {
    assert.doesNotMatch(t, /\{\{/, 'every slot filled');
    assert.doesNotMatch(t, /suicid|self-harm|abuse|violen|kill|safe/i, 'nothing that says why');
    assert.ok(t.length <= 320, 'two SMS segments at most');
  }
});

test('the reply alert says nothing about the message', () => {
  assert.doesNotMatch(replyAlertText, /\{\{/);
  assert.ok(!replyAlertText.includes('"…"') || replyAlertText.includes('--reply'));
});
