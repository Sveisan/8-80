import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { previewServer } from '../src/unblock/preview.ts';

const localInput = (days: number): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(Date.now() + days * 86400_000)).replace(' ', 'T').slice(0, 11) + '18:00';

async function walk(): Promise<{ base: string; get(path: string): Promise<Response>; post(path: string, fields: [string, string][] | Record<string, string>, csrf?: string): Promise<Response>; html(): string; cookie(): string; close(): Promise<void> }> {
  const server = previewServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port; let cookie = ''; let html = '';
  const hidden = (name: string): string => { const found = html.match(new RegExp('name="' + name + '" value="([^"<>]*)"'))?.[1]; assert.notEqual(found, undefined, name); return found!; };
  const get = async (path: string): Promise<Response> => { const response = await fetch(base + path, { headers: { cookie }, redirect: 'manual' }); cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie; html = await response.text(); return response; };
  const post = async (path: string, fields: [string, string][] | Record<string, string>, csrf?: string): Promise<Response> => {
    const body = new URLSearchParams([['csrf', csrf ?? hidden('csrf')], ...(Array.isArray(fields) ? fields : Object.entries(fields))]);
    const response = await fetch(base + path, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie; html = await response.text();
    if (response.status === 303) await get(response.headers.get('location')!);
    return response;
  };
  return { base, get, post, html: () => html, cookie: () => cookie, close: () => new Promise<void>(r => server.close(() => r())) };
}
const schedule: [string, string][] = [['action', 'schedule'], ['timezone', 'Europe/Oslo'], ['opening_local', localInput(2)], ['weekday', '0'], ['weekly', '17:00'], ['light_choice', 'evenings'], ['light_day', '1'], ['light_day', '3'], ['light_day', '5'], ['light', '19:00']];

test('preview walks the whole journey: join, verify, schedule, simulated payment, calls, week-4 read-back, then the finished account', async () => {
  const w = await walk();
  try {
    await w.get('/unblock'); assert.ok(w.html().includes('See the light in your own life'));
    await w.get('/unblock/join'); assert.ok(w.cookie().startsWith('unblock_preview_'));
    const rejected = await fetch(w.base + '/unblock/join', { method: 'POST', body: new URLSearchParams({ csrf: 'bad', phone: '+4791000010', consent: 'yes' }), redirect: 'manual' });
    assert.equal(rejected.status, 403);
    assert.equal((await w.post('/unblock/join', { phone: '+4791000010', name: 'Synthetic tester' })).status, 400); // no consent
    await w.post('/unblock/join', { phone: '+4791000010', name: 'Synthetic tester', consent: 'yes' }); assert.ok(w.html().includes('000000'));
    assert.equal((await w.post('/unblock/verify', { code: '111111' })).status, 400);
    await w.post('/unblock/verify', { code: '000000' }); assert.ok(w.html().includes('Make room for it'));
    assert.ok(w.html().includes('No light calls'));
    await w.post('/unblock/action', schedule); assert.ok(w.html().includes('Your next call') === false, 'no next call before payment');
    assert.ok(w.html().includes('Preview payment confirmation'));
    await w.post('/unblock/action', { action: 'pay' }); assert.ok(w.html().includes('Opening conversation'));
    assert.ok(w.html().includes('Move only this call') && w.html().includes('Skip this call'));
    await w.post('/unblock/action', { action: 'sim_call' }); // opening held
    assert.ok(w.html().includes('Synthetic wish: learn to sail')); assert.ok(w.html().includes('Light call'));
    for (let i = 0; i < 3; i++) await w.post('/unblock/action', { action: 'sim_light' });
    assert.ok(w.html().includes('What was alive'));
    for (let week = 1; week <= 3; week++) await w.post('/unblock/action', { action: 'sim_call' });
    assert.ok(w.html().includes('would be read back'), 'week-4 read-back preview is visible before the last call');
    assert.ok(w.html().includes('Synthetic wish, reworded')); assert.ok(w.html().includes('Earlier versions'));
    assert.ok(w.html().includes('A real limit') && w.html().includes('A prediction'));
    await w.post('/unblock/action', { action: 'sim_call' }); // week 4 closing
    assert.ok(w.html().includes('Where you landed')); assert.ok(w.html().includes('Synthetic carry'));
    assert.ok(!w.html().includes('Your calls have ended'), 'the close ends the chapter, not the programme'); assert.ok(!w.html().includes('Opening conversation'));
    assert.ok(w.html().includes('Simulate the next chapter (billing month) starting'), 'the next chapter waits for the next billing month');
    await w.post('/unblock/action', { action: 'sim_month' }); assert.ok(w.html().includes('This month · The First Mile')); assert.doesNotMatch(w.html().replace(/<style>[\s\S]*?<\/style>/g, ''), /\b\d+ of \d+\b|all held/, 'calls held are never counted');
    assert.ok(w.html().includes('Where you landed · The Wish'), 'the first chapter\'s closing is kept under its chapter');
    assert.ok(!/five weeks|one-time|last Unblock call/i.test(w.html()));
    assert.equal((w.html().match(/Beliefs/g) ?? []).length, 1, 'one quiet mention of Beliefs, in the footer');
    await w.post('/unblock/action', { action: 'signout' }); assert.ok(w.html().includes('See the light'));
  } finally { await w.close(); }
});

test('preview: subscription controls with simulated standing: calls per month apply from the next chapter, cancel, billing note and an ended subscription', async () => {
  const w = await walk();
  try {
    await w.get('/unblock/join'); await w.post('/unblock/join', { phone: '+4791000012', consent: 'yes' }); await w.post('/unblock/verify', { code: '000000' });
    await w.post('/unblock/action', [...schedule, ['calls', '2']]); assert.ok(w.html().includes('Preview payment confirmation'));
    await w.post('/unblock/action', { action: 'pay' });
    assert.ok(w.html().includes('data-seam="subscription"') && w.html().includes('Active')); assert.ok(w.html().includes('2 a month'));
    await w.post('/unblock/action', { action: 'calls', calls: '6' }); assert.ok(w.html().includes('6 a month') || w.html().includes('<option value="6" selected>'), 'before the first call a change applies at once');
    assert.ok(!w.html().includes('From your next chapter'));
    await w.post('/unblock/action', { action: 'sim_call' }); // opening held
    await w.post('/unblock/action', { action: 'calls', calls: '3' }); assert.ok(w.html().includes('This chapter keeps 6. From your next chapter: 3.'));
    assert.equal((await w.post('/unblock/action', { action: 'calls', calls: '9' })).status, 400);
    for (let i = 0; i < 6; i++) await w.post('/unblock/action', { action: 'sim_call' });
    assert.ok(w.html().includes('Where you landed')); await w.post('/unblock/action', { action: 'sim_month' });
    assert.ok(w.html().includes('3 a month'), 'the pending choice starts with the new month'); assert.doesNotMatch(w.html().replace(/<style>[\s\S]*?<\/style>/g, ''), /\b\d+ of \d+\b|all held/);
    await w.post('/unblock/action', { action: 'pause' }); assert.ok(w.html().includes('does not pause billing') || w.html().includes('Resume my calls'));
    await w.post('/unblock/action', { action: 'resume' });
    await w.post('/unblock/action', { action: 'billing' }); assert.ok(w.html().includes('not part of this preview'));
    await w.post('/unblock/action', { action: 'cancel' }); assert.ok(w.html().includes('Cancelling on')); assert.ok(w.html().includes('Your calls continue until then'));
    await w.post('/unblock/action', { action: 'sim_end' }); assert.ok(w.html().includes('Ended.')); assert.ok(!w.html().includes('Skip this call'));
  } finally { await w.close(); }
});

test('preview: nothing to pause or end before payment; a simulated end cannot be run early; the next light evening follows simulated time', async () => {
  const w = await walk();
  try {
    await w.get('/unblock/join'); await w.post('/unblock/join', { phone: '+4791000013', consent: 'yes' }); await w.post('/unblock/verify', { code: '000000' });
    await w.post('/unblock/action', schedule);
    assert.ok(!w.html().includes('Pause my calls') && !w.html().includes('Resume my calls'), 'no pause control before the subscription is active');
    assert.equal((await w.post('/unblock/action', { action: 'sim_end' })).status, 400); assert.ok(!w.html().includes('Your calls have ended'));
    await w.post('/unblock/action', { action: 'pay' }); assert.ok(w.html().includes('Opening conversation') && w.html().includes('Pause my calls'));
    await w.post('/unblock/action', { action: 'sim_call' });
    const light = () => w.html().match(/Next light call: <time datetime="([^"]+)"/)![1]!;
    const first = light(); await w.post('/unblock/action', { action: 'sim_light' }); await w.post('/unblock/action', { action: 'sim_light' });
    assert.ok(+new Date(light()) > +new Date(first) + 86400_000, 'the light card moves on with the simulated days');
  } finally { await w.close(); }
});

test('preview: skip, move, pause and resume; no light calls is a clear choice; a missed call is not made up', async () => {
  const w = await walk();
  try {
    await w.get('/unblock/join'); await w.post('/unblock/join', { phone: '+4791000011', consent: 'yes' }); await w.post('/unblock/verify', { code: '000000' });
    await w.post('/unblock/action', schedule.map(([k, v]) => [k, v] as [string, string]).filter(([k]) => !k.startsWith('light_')).concat([['light_choice', 'none']]));
    await w.post('/unblock/action', { action: 'pay' });
    const first = w.html().match(/name="expected_at" value="([^"]+)"/)![1]!;
    await w.post('/unblock/action', { action: 'sim_missed' }); assert.ok(w.html().includes('not made up later'));
    assert.notEqual(w.html().match(/name="expected_at" value="([^"]+)"/)![1], first);
    await w.post('/unblock/action', { action: 'pause' }); assert.ok(w.html().includes('Your calls are paused')); assert.ok(!w.html().includes('Skip this call'));
    await w.post('/unblock/action', { action: 'resume' }); assert.ok(w.html().includes('Skip this call'));
    await w.post('/unblock/action', { action: 'sim_call' }); assert.ok(w.html().includes('You have chosen no light calls'));
    await w.post('/unblock/action', { action: 'sim_call' }); // week 1 with no light calls: a weekly moment is kept instead
    assert.ok(w.html().includes('What was alive'), 'with no light calls each regular call keeps one moment');
    const current = w.html().match(/name="expected_at" value="([^"]+)"/)![1]!;
    await w.post('/unblock/action', { action: 'skip', kind: 'call', expected_at: current }); assert.notEqual(w.html().match(/name="expected_at" value="([^"]+)"/)![1], current);
    assert.equal((await w.post('/unblock/action', { action: 'skip', kind: 'call', expected_at: current })).status, 400, 'a stale skip is refused');
  } finally { await w.close(); }
});

test('preview is private by default: pages are no-store, no-referrer, scoped, and private routes need verification', async () => {
  const w = await walk();
  try {
    const response = await w.get('/unblock'); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy')!, /default-src 'none'.*script-src 'sha256-/);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax/); assert.match(response.headers.get('set-cookie')!, /Path=\/unblock/);
    assert.equal((await w.get('/unblock/account')).status, 303);
  } finally { await w.close(); }
});
