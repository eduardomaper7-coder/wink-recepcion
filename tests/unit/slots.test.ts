import { describe, expect, it } from 'vitest';
import { proposeSlots, zonedTime } from '@/calendar/slots';

const cfg = { start: '09:30', end: '18:00', days: [1, 2, 3, 4, 5], tz: 'Europe/Madrid', buffer_min: 30, lookahead_days: 10, slots_to_propose: 3 };
const madridHour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(d));
const madridWeekday = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', weekday: 'short' }).format(d);

describe('proposeSlots', () => {
  it('propone 3 huecos en días laborables distintos, dentro del horario, desde pasado mañana', () => {
    const now = new Date('2026-11-20T18:00:00Z'); // viernes
    const slots = proposeSlots(now, [], cfg, 90);
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(['Sat', 'Sun']).not.toContain(madridWeekday(s.start));
      expect(madridHour(s.start)).toBeGreaterThanOrEqual(9);
      expect(madridHour(s.end)).toBeLessThanOrEqual(18);
      expect(s.start.getTime()).toBeGreaterThan(now.getTime() + 36 * 3600_000);
    }
    expect(new Set(slots.map((s) => s.start.toDateString())).size).toBe(3);
  });

  it('evita la ocupación de la agenda (con margen)', () => {
    const now = new Date('2026-11-20T18:00:00Z');
    const busyDay = zonedTime(2026, 11, 23, '09:30', 'Europe/Madrid');
    const busy = [{ start: busyDay, end: zonedTime(2026, 11, 23, '13:00', 'Europe/Madrid') }];
    const [first] = proposeSlots(now, busy, cfg, 90);
    expect(first.start.getTime()).toBeGreaterThanOrEqual(zonedTime(2026, 11, 23, '13:30', 'Europe/Madrid').getTime());
  });

  it('zonedTime respeta el horario de invierno de Madrid (UTC+1)', () => {
    expect(zonedTime(2026, 11, 23, '10:00', 'Europe/Madrid').toISOString()).toBe('2026-11-23T09:00:00.000Z');
  });
});

import { parseAvailability } from '@/calendar/slots';

describe('disponibilidad del cliente', () => {
  const cfg2 = { start: '09:30', end: '18:00', days: [1, 2, 3, 4, 5], tz: 'Europe/Madrid', buffer_min: 30, lookahead_days: 10, slots_to_propose: 3 };
  const hourMadrid = (d: Date) => Number(new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(d));
  const wdMadrid = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', weekday: 'short' }).format(d);

  it('mañanas, menos el viernes', () => {
    const p = parseAvailability('Me viene mejor por la mañana, cualquier día menos el viernes');
    expect(p).toMatchObject({ part: 'manana', excludeDays: [5], days: null });
    const slots = proposeSlots(new Date('2026-11-22T12:00:00Z'), [], cfg2, 90, p);
    expect(slots).toHaveLength(3);
    for (const s of slots) {
      expect(hourMadrid(s.end)).toBeLessThanOrEqual(14);
      expect(wdMadrid(s.start)).not.toBe('Fri');
    }
  });

  it('tardes a partir de las 17:00', () => {
    const p = parseAvailability('Podemos cualquier tarde a partir de las 17:00');
    expect(p).toMatchObject({ part: 'tarde', from: '17:00' });
    const slots = proposeSlots(new Date('2026-11-22T12:00:00Z'), [], { ...cfg2, end: '19:30' }, 90, p);
    for (const s of slots) expect(hourMadrid(s.start)).toBeGreaterThanOrEqual(17);
  });

  it('solo lunes y miércoles por la mañana', () => {
    const p = parseAvailability('lunes y miércoles por la mañana');
    expect(p).toMatchObject({ part: 'manana', days: [1, 3] });
    const slots = proposeSlots(new Date('2026-11-22T12:00:00Z'), [], cfg2, 90, p);
    for (const s of slots) expect(['Mon', 'Wed']).toContain(wdMadrid(s.start));
  });

  it('sin preferencias reconocibles no restringe', () => {
    expect(parseAvailability('cuando os venga bien')).toBeNull();
    expect(parseAvailability(null)).toBeNull();
  });
});
