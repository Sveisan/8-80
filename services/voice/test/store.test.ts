import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { FileStore } from '../src/store/file.ts';
import { decrypt, encrypt } from '../src/store/crypto.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * Awaits the body before restoring the key. A synchronous `finally` around an
 * async function restores it while the work is still running, which is a way
 * to write a test that passes for the wrong reason.
 */
async function withKey<T>(fn: () => T | Promise<T>): Promise<T> {
  const before = process.env['DATA_ENCRYPTION_KEY'];
  process.env['DATA_ENCRYPTION_KEY'] = KEY;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env['DATA_ENCRYPTION_KEY'];
    else process.env['DATA_ENCRYPTION_KEY'] = before;
  }
}

test('what someone said survives a round trip and is unreadable in between', async () => {
  await withKey(() => {
    const sealed = encrypt('run three times');
    assert.ok(!sealed.includes('run'), 'the plaintext must not be sitting in the value');
    assert.equal(decrypt(sealed), 'run three times');
  });
});

test('a tampered record fails rather than decrypting to something else', async () => {
  await withKey(() => {
    const sealed = encrypt('call my sister');
    const [iv, tag, body] = sealed.split('.');
    const flipped = Buffer.from(body as string, 'base64');
    flipped[0] = (flipped[0] as number) ^ 0xff;
    assert.throws(() => decrypt([iv, tag, flipped.toString('base64')].join('.')));
  });
});

test('the first call has no history, and the second one does', async () => {
  await withKey(async () => {
    const store = new FileStore(mkdtempSync(resolve(tmpdir(), '8and80-')));
    const first = await store.load('+4790000000');
    assert.equal(first.callNumber, 1);
    assert.equal(first.lastCommitment, undefined);

    await store.record('+4790000000', { at: new Date().toISOString(), durationMs: 1000, commitment: 'run three times', day: 'wednesday' });
    const second = await store.load('+4790000000');
    assert.equal(second.callNumber, 2);
    assert.equal(second.lastCommitment, 'run three times');
    assert.equal(second.lastCommitmentDay, 'wednesday');
  });
});

test('a call that reached no commitment leaves last week standing', async () => {
  await withKey(async () => {
    const store = new FileStore(mkdtempSync(resolve(tmpdir(), '8and80-')));
    await store.record('+4790000001', { at: new Date().toISOString(), durationMs: 1000, commitment: 'run three times' });
    await store.record('+4790000001', { at: new Date().toISOString(), durationMs: 1000 });
    const after = await store.load('+4790000001');
    // They are still on the hook for what they said the week before.
    assert.equal(after.lastCommitment, 'run three times');
    assert.equal(after.callNumber, 3);
  });
});

test('nothing is written in the clear when there is no key', async () => {
  const dir = mkdtempSync(resolve(tmpdir(), '8and80-'));
  const before = process.env['DATA_ENCRYPTION_KEY'];
  delete process.env['DATA_ENCRYPTION_KEY'];
  try {
    const store = new FileStore(dir);
    await store.record('+4790000002', { at: new Date().toISOString(), durationMs: 1000, commitment: 'something private' });
    assert.deepEqual(readdirSync(dir), [], 'no key means no record, not a plaintext record');
  } finally {
    if (before !== undefined) process.env['DATA_ENCRYPTION_KEY'] = before;
  }
});

test('the number is not the filename, and the words are not in the file', async () => {
  await withKey(async () => {
    const dir = mkdtempSync(resolve(tmpdir(), '8and80-'));
    const store = new FileStore(dir);
    await store.record('+4790033575', { at: new Date().toISOString(), durationMs: 1000, commitment: 'phone my brother' });
    const [file] = readdirSync(dir);
    assert.ok(file && !file.includes('4790033575'), 'a directory listing must not be a list of phone numbers');
    const raw = readFileSync(resolve(dir, file as string), 'utf8');
    assert.ok(!raw.includes('phone my brother'), 'what they said must not be readable in the file');
  });
});
