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

/** Preferencias de visita que expresa el cliente ("por la mañana, menos el viernes", "tardes a partir de las 17:00"). */
export interface VisitPreference {
  part: 'manana' | 'tarde' | null;
  from: string | null; // HH:MM, "a partir de las 17:00"
  days: number[] | null; // solo estos días (1 = lunes)
  excludeDays: number[];
}

const DAY_WORDS: [RegExp, number][] = [
  [/lunes/, 1], [/martes/, 2], [/mi[eé]rcoles/, 3], [/jueves/, 4], [/viernes/, 5], [/s[aá]bados?/, 6], [/domingos?/, 7],
];

/** Interpreta la disponibilidad escrita por el cliente. Determinista: si no entiende algo, no restringe. */
export function parseAvailability(text: string | null | undefined): VisitPreference | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const pref: VisitPreference = { part: null, from: null, days: null, excludeDays: [] };
  const morning = /\bma[ñn]anas?\b/.test(t) && !/\bpasado ma[ñn]ana\b/.test(t);
  const afternoon = /\btardes?\b/.test(t);
  if (morning && !afternoon) pref.part = 'manana';
  if (afternoon && !morning) pref.part = 'tarde';
  const from = /a partir de las?\s*(\d{1,2})(?:[:.h](\d{2}))?/.exec(t);
  if (from) pref.from = `${from[1].padStart(2, '0')}:${from[2] ?? '00'}`;
  // "menos el viernes", "excepto lunes y martes", "salvo los viernes"
  const exc = /(?:menos|excepto|salvo|no puedo(?: los?)?)\s+(?:el |los |la )?([a-zéíáú ,y]+)/.exec(t);
  if (exc) for (const [re, n] of DAY_WORDS) if (re.test(exc[1])) pref.excludeDays.push(n);
  const rest = exc ? t.replace(exc[0], ' ') : t;
  const only = DAY_WORDS.filter(([re]) => re.test(rest)).map(([, n]) => n);
  if (only.length && !/cualquier d[ií]a/.test(rest)) pref.days = only;
  if (!pref.part && !pref.from && !pref.days && !pref.excludeDays.length) return null;
  return pref;
}

/**
 * Propone N huecos en días distintos, alternando mañana/tarde, a partir de pasado mañana
 * (para dar margen a la aprobación del arquitecto y a la respuesta del cliente).
 */
export function proposeSlots(now: Date, busy: Interval[], cfg: VisitHours, durationMin: number, pref: VisitPreference | null = null): Interval[] {
  const out: Interval[] = [];
  const dur = durationMin * 60_000;
  const buffer = cfg.buffer_min * 60_000;
  const step = 30 * 60_000;
  const padded = busy.map((b) => ({ start: new Date(b.start.getTime() - buffer), end: new Date(b.end.getTime() + buffer) }));

  for (let offset = 2; offset <= cfg.lookahead_days + 2 && out.length < cfg.slots_to_propose; offset++) {
    const day = new Date(now.getTime() + offset * 86_400_000);
    const lp = localParts(day, cfg.tz);
    if (!cfg.days.includes(lp.weekday)) continue;
    if (pref?.excludeDays.includes(lp.weekday)) continue;
    if (pref?.days && !pref.days.includes(lp.weekday)) continue;
    // Ventana del día: horario de visitas de Wink recortado por la preferencia del cliente
    let startHHMM = cfg.start;
    let endHHMM = cfg.end;
    if (pref?.part === 'manana') endHHMM = minHHMM(endHHMM, '14:00');
    if (pref?.part === 'tarde') startHHMM = maxHHMM(startHHMM, '15:00');
    if (pref?.from) startHHMM = maxHHMM(startHHMM, pref.from);
    const dayStart = zonedTime(lp.y, lp.m, lp.d, startHHMM, cfg.tz);
    const dayEnd = zonedTime(lp.y, lp.m, lp.d, endHHMM, cfg.tz);
    const preferAfternoon = pref?.part || pref?.from ? false : out.length % 2 === 1;
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

const minHHMM = (a: string, b: string) => (a < b ? a : b);
const maxHHMM = (a: string, b: string) => (a > b ? a : b);
