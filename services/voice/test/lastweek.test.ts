import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadScript } from '../src/script.ts';
import { lastWeek } from '../src/call/lastweek.ts';
import { settle } from '../src/call/outcome.ts';
import { FileStore } from '../src/store/file.ts';

const script = loadScript();
const say = (id: string) => script.get(id) ?? assert.fail(`SCRIPT.md has no ${id}`);

test('the branch the mentor took is how the week went', () => {
  assert.equal(lastWeek(['Hello again.', say('last.did')], script), 'done');
  assert.equal(lastWeek([say('last.partial'), say('block.ask')], script), 'partly', 'partly, even though it asked what was in the way');
  assert.equal(lastWeek([say('nothing.b')], script), 'undone');
  assert.equal(lastWeek(['Mm.', say('block.ask')], script), 'undone');
});

test('a bare "Mm." on its own records nothing, and neither does a first call', () => {
  // nothing.c is indistinguishable from any other Mm.
  assert.equal(lastWeek(['Mm.'], script), undefined);
  assert.equal(lastWeek([say('open.first.greet'), say('open.first.disclosure')], script), undefined);
});

test('a settled call carries the week with it', () => {
  const s = settle(
    {
      providerCallId: 'c2',
      durationMs: 500_000,
      turns: [
        { speaker: 'agent', text: say('open.return.greet') },
        { speaker: 'caller', text: 'Did it, all three.' },
        { speaker: 'agent', text: say('last.did') },
      ],
    },
    script,
  );
  assert.equal(s.outcome?.lastWeek, 'done');
});

test('undone weeks run up the count, and a done week resets it', async () => {
  const before = process.env['DATA_ENCRYPTION_KEY'];
  process.env['DATA_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64');
  try {
    const store = new FileStore(mkdtempSync(resolve(tmpdir(), '8and80-')));
    const phone = '+4790000003';
    const week = (lastWeek?: 'done' | 'partly' | 'undone') =>
      store.record(phone, { at: new Date().toISOString(), durationMs: 1000, ...(lastWeek ? { lastWeek } : {}) });

    await week('undone');
    await week('undone');
    await week(); // not established: leaves everything where it was
    await week('undone');
    assert.equal((await store.load(phone)).consecutiveUndone, 3, 'the third week running, which is what nothing.pattern waits for');

    await week('partly');
    await week('done');
    const after = await store.load(phone);
    assert.equal(after.consecutiveUndone, 0);
    assert.deepEqual([after.weeksDone, after.weeksPartly, after.weeksUndone], [1, 1, 3]);
  } finally {
    if (before === undefined) delete process.env['DATA_ENCRYPTION_KEY'];
    else process.env['DATA_ENCRYPTION_KEY'] = before;
  }
});
