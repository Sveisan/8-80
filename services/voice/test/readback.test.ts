import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../src/script.ts';
import { extractSlots, readBack } from '../src/call/readback.ts';
import { extractCommitment } from '../src/call/commitment.ts';
import { settle } from '../src/call/outcome.ts';

const script = loadScript();

test('their eight and eighty come out of the read-back, in their words', () => {
  const found = readBack(
    ['Mm.', 'Let me say it back. At eight, building dens in the woods. By eighty, a family. And this year, the apartment and a stand-up set. Have I got that right?', 'Which one?'],
    script.get('read.first.keep'),
  );
  assert.deepEqual(found, { eight: 'building dens in the woods', eighty: 'a family', goals: 'the apartment and a stand up set' });
});

test('a read-back that dropped its closing words still counts, inside its own turn', () => {
  const found = readBack(['Let me say it back. At eight, building dens. By eighty, a family. And this year, stand-up.', 'Anyway.'], script.get('read.first.keep'));
  assert.deepEqual(found, { eight: 'building dens', eighty: 'a family', goals: 'stand up' });
});

test('across a whole call a read-back must be complete, or the last slot is everything said after it', () => {
  assert.equal(extractSlots('so the assumption is nobody will pay and then a lot more talk', script.get('belief.name'), { strict: true }), undefined);
});

test('half a read-back is not one', () => {
  assert.equal(readBack(['So the assumption is'], script.get('belief.name')), undefined);
  assert.equal(readBack(['What did you love doing at eight?'], script.get('read.first.keep')), undefined);
});

test('the commitment read-back that ends on a question still yields the commitment', () => {
  const c = extractCommitment('Right. Call two members after standup, Thursday. Will you?', script);
  assert.equal(c?.text, 'call two members after standup');
  assert.equal(c?.day, 'thursday');
});

test('a finished call keeps what was read back, and nothing that was not', () => {
  const settled = settle(
    {
      providerCallId: 'c1',
      durationMs: 600_000,
      turns: [
        { speaker: 'agent', text: 'Is that something you know, or something you\'ve assumed?' },
        { speaker: 'caller', text: 'Assumed, I suppose. That nobody will pay for it.' },
        { speaker: 'agent', text: 'So the assumption is: nobody will pay for it.' },
        { speaker: 'caller', text: 'Yeah.' },
        { speaker: 'agent', text: 'Right. Ask two members for money after standup, Thursday. Will you?' },
      ],
    },
    script,
  );
  assert.equal(settled.outcome?.belief, 'nobody will pay for it');
  assert.equal(settled.outcome?.commitment, 'ask two members for money after standup');
  assert.equal(settled.outcome?.eight, undefined, 'never asked, so never kept');
});
