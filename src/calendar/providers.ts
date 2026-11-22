/**
 * Agenda configurable: mock (demo), Google Calendar o Microsoft 365.
 * Google y Microsoft usan sus API REST oficiales (freeBusy / getSchedule y creación de eventos).
 * NOTA: los adaptadores reales no se han podido probar sin credenciales de Wink.
 */
import { env } from '@/config/env';
import type { Interval } from './slots';

export interface VisitEvent {
  title: string;
  description: string;
  start: Date;
  end: Date;
  location?: string | null;
  attendees?: string[];
}

export interface CalendarProvider {
  readonly name: string;
  busy(from: Date, to: Date): Promise<Interval[]>;
  createEvent(e: VisitEvent): Promise<{ eventId: string }>;
}

/** Agenda simulada y determinista: ocupa algunos tramos para que la propuesta sea realista. */
export class MockCalendar implements CalendarProvider {
  readonly name = 'mock';
  async busy(from: Date, to: Date): Promise<Interval[]> {
    const out: Interval[] = [];
    for (let t = new Date(from); t < to; t = new Date(t.getTime() + 86_400_000)) {
      const d = t.getUTCDate();
      const base = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
      // Mañanas ocupadas los días pares (9:00–12:30 Madrid ≈ 8:00–11:30 UTC en invierno)
      if (d % 2 === 0) out.push({ start: new Date(base + 8 * 3600_000), end: new Date(base + 11.5 * 3600_000) });
      // Una reunión a primera hora de la tarde cada 3 días
      if (d % 3 === 0) out.push({ start: new Date(base + 13 * 3600_000), end: new Date(base + 14.5 * 3600_000) });
    }
    return out;
  }
  async createEvent(e: VisitEvent) {
    return { eventId: `mock-${e.start.getTime()}` };
  }
}

export class GoogleCalendar implements CalendarProvider {
  readonly name = 'google';
  private token: { value: string; exp: number } | null = null;

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 30_000) return this.token.value;
    const e = env();
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: e.GOOGLE_CLIENT_ID,
        client_secret: e.GOOGLE_CLIENT_SECRET,
        refresh_token: e.GOOGLE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`Google OAuth: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async busy(from: Date, to: Date): Promise<Interval[]> {
    const calendarId = env().GOOGLE_CALENDAR_ID;
    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: calendarId }] }),
    });
    if (!res.ok) throw new Error(`Google freeBusy: ${res.status}`);
    const j = (await res.json()) as { calendars: Record<string, { busy: { start: string; end: string }[] }> };
    return (j.calendars[calendarId]?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  }

  async createEvent(e: VisitEvent) {
    const calendarId = encodeURIComponent(env().GOOGLE_CALENDAR_ID);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary: e.title,
        description: e.description,
        location: e.location ?? undefined,
        start: { dateTime: e.start.toISOString(), timeZone: 'Europe/Madrid' },
        end: { dateTime: e.end.toISOString(), timeZone: 'Europe/Madrid' },
        attendees: e.attendees?.map((email) => ({ email })),
      }),
    });
    if (!res.ok) throw new Error(`Google events.insert: ${res.status}`);
    const j = (await res.json()) as { id: string };
    return { eventId: j.id };
  }
}

export class MicrosoftCalendar implements CalendarProvider {
  readonly name = 'microsoft';
  private token: { value: string; exp: number } | null = null;

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 30_000) return this.token.value;
    const e = env();
    const res = await fetch(`https://login.microsoftonline.com/${e.MS_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: e.MS_CLIENT_ID,
        client_secret: e.MS_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });
    if (!res.ok) throw new Error(`Microsoft OAuth: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async busy(from: Date, to: Date): Promise<Interval[]> {
    const user = env().MS_CALENDAR_USER;
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/calendar/getSchedule`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        schedules: [user],
        startTime: { dateTime: from.toISOString().slice(0, 19), timeZone: 'UTC' },
        endTime: { dateTime: to.toISOString().slice(0, 19), timeZone: 'UTC' },
        availabilityViewInterval: 30,
      }),
    });
    if (!res.ok) throw new Error(`Graph getSchedule: ${res.status}`);
    const j = (await res.json()) as { value: { scheduleItems: { start: { dateTime: string }; end: { dateTime: string } }[] }[] };
    return (j.value[0]?.scheduleItems ?? []).map((i) => ({ start: new Date(`${i.start.dateTime}Z`), end: new Date(`${i.end.dateTime}Z`) }));
  }

  async createEvent(e: VisitEvent) {
    const user = env().MS_CALENDAR_USER;
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(user)}/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: e.title,
        body: { contentType: 'text', content: e.description },
        start: { dateTime: e.start.toISOString().slice(0, 19), timeZone: 'UTC' },
        end: { dateTime: e.end.toISOString().slice(0, 19), timeZone: 'UTC' },
        location: e.location ? { displayName: e.location } : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Graph create event: ${res.status}`);
    const j = (await res.json()) as { id: string };
    return { eventId: j.id };
  }
}

let instance: CalendarProvider | null = null;
export function calendar(): CalendarProvider {
  if (instance) return instance;
  const p = env().CALENDAR_PROVIDER;
  instance = p === 'google' ? new GoogleCalendar() : p === 'microsoft' ? new MicrosoftCalendar() : new MockCalendar();
  return instance;
}
