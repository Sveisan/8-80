export interface CalendarEvent {
  uid: string;
  sequence: number;
  method: 'REQUEST' | 'CANCEL';
  at: string;
  stamp: string;
  timezone: string;
  /** Copy is captured with the message so retries keep the same calendar contents. */
  title?: string;
  description?: string;
  /** Null omits the place; absent preserves the contents of older queued mail. */
  location?: string | null;
}

const timestamp = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\r?\n|\r/g, '\\n').replace(/[,;]/g, '\\$&');

/** RFC 5545 counts UTF-8 octets, including the continuation space. */
function fold(line: string): string {
  let result = '', width = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character);
    if (width + bytes > 75) { result += '\r\n '; width = 1; }
    result += character;
    width += bytes;
  }
  return result;
}

export function calendarFile(event: CalendarEvent, from: string, to: string): string {
  const organizer = /<([^<>]+)>/.exec(from)?.[1] ?? from.trim();
  // These values are URI properties rather than text: reject line injection.
  for (const address of [organizer, to]) if (!/^[^\s<>:,;@]+@[^\s<>:,;@]+$/.test(address)) throw new Error('Invalid calendar address');
  if (!/^[a-zA-Z0-9@._-]+$/.test(event.uid) || !Number.isSafeInteger(event.sequence) || event.sequence < 0) throw new Error('Invalid calendar identity');
  const cancelled = event.method === 'CANCEL';
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//8and80//Call invitations//EN', 'CALSCALE:GREGORIAN', `METHOD:${event.method}`,
    'BEGIN:VEVENT', `UID:${event.uid}`, `SEQUENCE:${event.sequence}`, `DTSTAMP:${timestamp(event.stamp)}`,
    `DTSTART:${timestamp(event.at)}`, `DTEND:${timestamp(new Date(+new Date(event.at) + 15 * 60_000).toISOString())}`,
    `SUMMARY:${escape(event.title ?? '8&80 call')}`,
    `DESCRIPTION:${escape(event.description ?? `We will call your phone at the scheduled time. Allow around 15 minutes. Booking timezone: ${event.timezone}.`)}`,
    ...(event.location === null ? [] : [`LOCATION:${escape(event.location ?? 'Phone call')}`]),
    `ORGANIZER;CN="8&80":mailto:${organizer}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${to}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'TRANSP:OPAQUE', 'CLASS:PRIVATE', 'END:VEVENT', 'END:VCALENDAR', '',
  ].map(fold).join('\r\n');
}
