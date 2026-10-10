import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { reschedulePage } from '../src/link/page.ts';
import { loadScript } from '../src/script.ts';

const script = loadScript();

/** Run the actual inline display script against the server-rendered appointment. */
function display(at: string, browserZone?: string, bookingZone = 'Europe/Oslo') {
  const html = reschedulePage({ weekday: 2, minute: 480, timezone: bookingZone }, script, 'en', undefined, undefined, { next: new Date(at) });
  const tag = /<time class="appointment"[^>]*>/.exec(html)?.[0];
  assert.ok(tag);
  const attributes = new Map([...tag.matchAll(/([a-z-]+)="([^"]*)"/g)].map(match => [match[1]!, match[2]!]));
  const text = (name: string) => {
    const found = new RegExp(`<(?:span|small) class="${name}">([^<]*)</(?:span|small)>`).exec(html)?.[1];
    assert.ok(found);
    return { textContent: found };
  };
  const date = text('appointment-date');
  const clock = text('appointment-clock');
  const zone = text('appointment-zone');
  const original = { date: date.textContent, clock: clock.textContent, zone: zone.textContent };
  const nodes = new Map([['.appointment-date', date], ['.appointment-clock', clock], ['.appointment-zone', zone]]);
  const appointment = {
    getAttribute: (name: string) => attributes.get(name),
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    querySelector: (selector: string) => nodes.get(selector),
  };
  const inline = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(inline);
  runInNewContext(inline, {
    document: {
      querySelector: (selector: string) => selector === 'time.appointment' ? appointment : undefined,
      getElementById: () => undefined,
    },
    Intl: {
      DateTimeFormat: function (locale?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        if (locale === undefined && options === undefined) return { resolvedOptions: () => ({ timeZone: browserZone }) };
        return new Intl.DateTimeFormat(locale, options);
      },
    },
  });
  return { date: date.textContent, clock: clock.textContent, zone: zone.textContent, original, attributes, html };
}

test('Oslo next-call time stays correct on both sides of the daylight-saving change', () => {
  for (const at of ['2026-10-20T06:00:00Z', '2026-10-27T07:00:00Z']) {
    const shown = display(at, 'Europe/Oslo');
    assert.equal(shown.clock, '08:00');
    assert.equal(shown.zone, 'Norwegian time');
    assert.equal(shown.attributes.get('datetime'), new Date(at).toISOString(), 'the booked instant must stay unchanged');
  }
});

test('viewer-local display converts the time and calendar date when travelling', () => {
  const london = display('2026-10-13T06:00:00Z', 'Europe/London');
  assert.equal(london.date, 'Tuesday 13 October');
  assert.equal(london.clock, '07:00');
  assert.equal(london.zone, 'London time');

  const newYork = display('2026-10-13T22:30:00Z', 'America/New_York');
  assert.equal(newYork.original.date, 'Wednesday 14 October');
  assert.equal(newYork.date, 'Tuesday 13 October');
  assert.equal(newYork.clock, '18:30');
  assert.equal(newYork.zone, 'New York time');
  assert.equal(newYork.attributes.get('aria-label'), 'Tuesday 13 October 18:30 New York time');
});

test('missing or unsupported device timezones preserve a usable saved-zone fallback', () => {
  for (const browserZone of [undefined, 'Mars/Olympus']) {
    const shown = display('2026-10-13T06:00:00Z', browserZone);
    assert.equal(shown.clock, '08:00');
    assert.equal(shown.zone, 'Norwegian time');
  }
  const london = display('2026-10-13T06:00:00Z', undefined, 'Europe/London');
  assert.equal(london.clock, '07:00');
  assert.equal(london.zone, 'London time');
});

test('local display keeps the skip target and explicitly labelled weekly picker in the saved zone', () => {
  const at = '2026-10-13T06:00:00Z';
  const shown = display(at, 'Europe/London');
  assert.equal(shown.clock, '07:00');
  assert.equal(shown.attributes.get('datetime'), new Date(at).toISOString());
  assert.match(shown.html, /Usually Tuesday 08:00 · Norwegian time\./);
  assert.match(shown.html, /name="skip_at" value="2026-10-13T06:00:00\.000Z"/);
  assert.match(shown.html, /name="time" value="08:00" checked/);
  assert.match(shown.html, /<p class="zone">Norwegian time<\/p>/);
});
