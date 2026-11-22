/** Propuesta de huecos de visita a partir de la ocupación de la agenda (lógica pura). */
import type { VisitHours } from '@/core/settings';

export interface Interval {
  start: Date;
  end: Date;
}

/** Fecha/hora local (zona tz) → instante UTC. */
export function zonedTime(year: number, month: number, day: number, hhmm: string, tz: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, h, m));
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

function localParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday as string] ?? 1;
  return { y: +p.year, m: +p.month, d: +p.day, weekday: wd };
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Propone N huecos en días distintos, alternando mañana/tarde, a partir de pasado mañana
 * (para dar margen a la aprobación del arquitecto y a la respuesta del cliente).
 */
export function proposeSlots(now: Date, busy: Interval[], cfg: VisitHours, durationMin: number): Interval[] {
  const out: Interval[] = [];
  const dur = durationMin * 60_000;
  const buffer = cfg.buffer_min * 60_000;
  const step = 30 * 60_000;
  const padded = busy.map((b) => ({ start: new Date(b.start.getTime() - buffer), end: new Date(b.end.getTime() + buffer) }));

  for (let offset = 2; offset <= cfg.lookahead_days + 2 && out.length < cfg.slots_to_propose; offset++) {
    const day = new Date(now.getTime() + offset * 86_400_000);
    const lp = localParts(day, cfg.tz);
    if (!cfg.days.includes(lp.weekday)) continue;
    const dayStart = zonedTime(lp.y, lp.m, lp.d, cfg.start, cfg.tz);
    const dayEnd = zonedTime(lp.y, lp.m, lp.d, cfg.end, cfg.tz);
    const preferAfternoon = out.length % 2 === 1;
    const candidates: Interval[] = [];
    for (let t = dayStart.getTime(); t + dur <= dayEnd.getTime(); t += step) {
      candidates.push({ start: new Date(t), end: new Date(t + dur) });
    }
    if (preferAfternoon) candidates.reverse();
    const free = candidates.find((c) => !padded.some((b) => overlaps(c, b)));
    if (free) out.push(free);
  }
  return out;
}
