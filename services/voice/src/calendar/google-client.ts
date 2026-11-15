import { OAuth2Client } from 'google-auth-library';
import { googleCalendarConfig, googleCalendarReady } from './google-config.ts';
import type { CalendarEvent } from './ical.ts';
import { SendFailure } from '../messages/types.ts';

export interface GoogleEvent {
  id: string; etag?: string; status?: string; organizer?: { self?: boolean };
  start?: { dateTime?: string }; end?: { dateTime?: string };
  recurrence?: string[]; recurringEventId?: string;
  attendees?: Array<{ email?: string }>;
  extendedProperties?: { private?: Record<string, string> };
}
export interface GoogleChanges { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string; }
export interface GoogleCalendar {
  calendarId: string;
  changes(calendarId: string, syncToken?: string, pageToken?: string): Promise<GoogleChanges>;
  publish(to: string, event: CalendarEvent): Promise<void>;
  remove(calendarId: string, eventId: string, notify?: boolean): Promise<void>;
}

export class GoogleCalendarError extends SendFailure {
  constructor(readonly status: number) {
    super(status === 429 || status >= 500 || [401,403,409,412].includes(status) ? 'retry' : 'permanent', `Google Calendar request failed (${status})`);
  }
}

export const googleEventId = (invitationId: string): string => `e${invitationId.replace(/-/g, '')}`;
export function publishedSequence(event: GoogleEvent): number | undefined {
  const value = event.extendedProperties?.private?.['eightand80Sequence'];
  return value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

/** Requests are confined to Google's API. Error bodies never reach logs or mail. */
export class GoogleCalendarClient implements GoogleCalendar {
  constructor(readonly calendarId: string, private readonly token: () => Promise<string>, private readonly requestFetch: typeof fetch = fetch) {}

  private async request(calendarId: string, path = '', method = 'GET', body?: unknown, query: Record<string,string> = {}, etag?: string): Promise<Response> {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${path}`);
    for (const [name,value] of Object.entries(query)) url.searchParams.set(name,value);
    let token: string;
    try { token = await this.token(); } catch { throw new SendFailure('retry', 'Google Calendar authorization unavailable'); }
    try {
      return await this.requestFetch(url, { method, redirect:'error', signal:AbortSignal.timeout(5000),
        headers:{authorization:`Bearer ${token}`, ...(body ? {'content-type':'application/json'} : {}), ...(etag ? {'If-Match':etag} : {})},
        ...(body ? {body:JSON.stringify(body)} : {}),
      });
    } catch { throw new SendFailure('retry', 'Google Calendar unavailable'); }
  }

  async changes(calendarId: string, syncToken?: string, pageToken?: string): Promise<GoogleChanges> {
    const response = await this.request(calendarId, '', 'GET', undefined, {maxResults:'250', showDeleted:'true',
      ...(syncToken ? {syncToken} : {}), ...(pageToken ? {pageToken} : {})});
    if (!response.ok) throw new GoogleCalendarError(response.status);
    return await response.json() as GoogleChanges;
  }

  async remove(calendarId: string, eventId: string, notify = true): Promise<void> {
    const response = await this.request(calendarId, `/${encodeURIComponent(eventId)}`, 'DELETE', undefined, {sendUpdates:notify ? 'all' : 'none'});
    if (![404,410].includes(response.status) && !response.ok) throw new GoogleCalendarError(response.status);
  }

  async publish(to: string, event: CalendarEvent): Promise<void> {
    const google = event.google;
    if (!google) throw new SendFailure('permanent', 'Missing Google Calendar identity');
    if (event.method === 'CANCEL') return await this.remove(google.calendarId, google.eventId);
    const path = `/${encodeURIComponent(google.eventId)}`;
    const read = await this.request(google.calendarId, path);
    if (!read.ok && ![404,410].includes(read.status)) throw new GoogleCalendarError(read.status);
    const existing = read.ok ? await read.json() as GoogleEvent : undefined;
    if (existing?.status === 'cancelled') throw new SendFailure('permanent', 'Google Calendar event was removed; renew calendar invitations to replace it');
    if (existing && (!existing.etag || existing.organizer?.self!==true)) throw new SendFailure('retry','Google Calendar organizer version could not be verified');
    if (existing && existing.extendedProperties?.private?.['eightand80Invitation'] !== event.uid) throw new SendFailure('permanent', 'Google Calendar event identity mismatch');
    // A retry must not undo a guest's edit of an already published revision.
    if (existing && (publishedSequence(existing) ?? -1) >= event.sequence) return;
    const sameTime = existing?.start?.dateTime && +new Date(existing.start.dateTime)===+new Date(event.at)
      && existing.end?.dateTime && +new Date(existing.end.dateTime)===+new Date(event.at)+15*60_000;
    if (existing && google.expectedEtag && existing.etag!==google.expectedEtag && !sameTime) throw new GoogleCalendarError(412);
    const body = {
      summary:event.title, description:event.description, visibility:'private', transparency:'opaque',
      start:{dateTime:event.at,timeZone:event.timezone,...(existing ? {date:null} : {})},
      end:{dateTime:new Date(+new Date(event.at) + 15*60_000).toISOString(),timeZone:event.timezone,...(existing ? {date:null} : {})},
      guestsCanModify:true, guestsCanInviteOthers:false, guestsCanSeeOtherGuests:false,
      extendedProperties:{private:{...existing?.extendedProperties?.private, eightand80Invitation:event.uid, eightand80Sequence:String(event.sequence)}},
      ...(!existing ? {id:google.eventId, attendees:[{email:to}]} : {recurrence:[]}),
    };
    const response = await this.request(google.calendarId, existing ? path : '', existing ? 'PATCH' : 'POST', body,
      {sendUpdates:sameTime ? 'none' : 'all'}, existing?.etag);
    if (!response.ok) throw new GoogleCalendarError(response.status);
  }
}

/** Only the organizer authorizes OAuth; customers grant no calendar-wide access. */
export function openGoogleCalendar(env: NodeJS.ProcessEnv = process.env): GoogleCalendar | undefined {
  if (!googleCalendarReady(env)) return undefined;
  const c = googleCalendarConfig(env);
  const auth = new OAuth2Client({clientId:c.clientId,clientSecret:c.clientSecret,transporterOptions:{timeout:5000}});
  auth.setCredentials({refresh_token:c.refreshToken});
  return new GoogleCalendarClient(c.calendarId, async () => {
    const value = await auth.getAccessToken();
    if (!value.token) throw new Error('No access token');
    return value.token;
  });
}
