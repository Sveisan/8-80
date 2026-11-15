import type { Mailer } from '../recap/mailer.ts';
import type { Recap } from '../recap/compose.ts';
import { SendFailure, type DeliveryStatus, type SendOptions } from '../messages/types.ts';
import type { GoogleCalendar } from './google-client.ts';

/** Native Google invitations carry the event; never attach a second .ics copy. */
export class GoogleCalendarMailer implements Mailer {
  readonly retryWindowMs = 24*3600_000;
  get previewOnly(): boolean { return this.email.previewOnly ?? false; }
  constructor(private readonly email: Mailer, private readonly google?: GoogleCalendar) {}
  async send(to: string, recap: Recap, options?: SendOptions) {
    if (!recap.calendar?.google) return await this.email.send(to,recap,options);
    if (!this.google) throw new SendFailure('retry','Google Calendar is not configured');
    await this.google.publish(to,recap.calendar);
    return {id:`gcal/${recap.calendar.google.eventId}/${recap.calendar.sequence}`};
  }
  async deliveryStatus(id: string): Promise<DeliveryStatus> {
    // This receipt means the calendar operation was published, not email delivery.
    if (id.startsWith('gcal/')) return 'delivered';
    return await this.email.deliveryStatus?.(id) ?? 'pending';
  }
}
