/** Detección determinista de incoherencias entre fuentes (cliente/personal vs documentos). */
import { IDENTITY_FIELDS, NUMERIC_FIELDS, FIELD_LABELS, type FactField } from './fields';
import { parseSpanishNumber } from '@/lib/text';

export interface FactRow {
  id: string;
  field: string;
  value: string;
  value_num: number | null;
  source_type: 'email' | 'document' | 'usuario';
  source_label: string | null;
  is_internal: boolean;
}

export interface DetectedInconsistency {
  field: string;
  description: string;
  factIds: string[];
}

/** Tolerancia relativa para valores numéricos (p. ej. 3 % en superficies) */
const TOLERANCE: Partial<Record<FactField, number>> = {
  'property.surface_m2': 0.03,
  'property.useful_surface_m2': 0.03,
  'property.building_year': 0,
};

export function detectInconsistencies(facts: FactRow[]): DetectedInconsistency[] {
  const out: DetectedInconsistency[] = [];
  const byField = new Map<string, FactRow[]>();
  for (const f of facts) byField.set(f.field, [...(byField.get(f.field) ?? []), f]);

  for (const field of NUMERIC_FIELDS) {
    const rows = (byField.get(field) ?? []).map((r) => ({ ...r, n: r.value_num ?? parseSpanishNumber(r.value) })).filter((r) => r.n !== null);
    if (rows.length < 2) continue;
    const tol = TOLERANCE[field] ?? 0.03;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        if (a.source_type === b.source_type && a.source_label === b.source_label) continue;
        const diff = Math.abs(a.n! - b.n!);
        const rel = diff / Math.max(Math.abs(a.n!), Math.abs(b.n!), 1);
        if (rel > tol) {
          const already = out.some((o) => o.field === field && o.factIds.includes(a.id) && o.factIds.includes(b.id));
          if (!already) {
            out.push({
              field,
              description: `${FIELD_LABELS[field]}: ${a.value} según ${a.source_label ?? a.source_type} frente a ${b.value} según ${b.source_label ?? b.source_type}`,
              factIds: [a.id, b.id],
            });
          }
        }
      }
    }
  }

  for (const field of IDENTITY_FIELDS) {
    const rows = byField.get(field) ?? [];
    const norm = field === 'property.floor' ? normalizeFloor : normalizeCadastral;
    const distinct = new Map<string, FactRow>();
    rows.forEach((r) => {
      const k = norm(r.value);
      if (k) distinct.set(k, r); // valores que no se pueden interpretar no generan incoherencia
    });
    if (field === 'property.floor' && distinct.size > 1) {
      // "4" y "4|IZQ" no se contradicen: la puerta solo cuenta si ambas fuentes la indican
      const keys = [...distinct.keys()];
      const nums = new Set(keys.map((k) => k.split('|')[0]));
      const doors = new Set(keys.map((k) => k.split('|')[1]).filter(Boolean));
      if (nums.size === 1 && doors.size <= 1) continue;
    }
    if (distinct.size > 1) {
      const list = [...distinct.values()];
      out.push({
        field,
        description: `${FIELD_LABELS[field as FactField]} no coincide entre fuentes: ${list.map((r) => `"${r.value}" (${r.source_label ?? r.source_type})`).join(' / ')}`,
        factIds: list.map((r) => r.id),
      });
    }
  }
  return out;
}

/** Valor "mejor" para un campo: prioridad documento oficial > correo del cliente > notas del personal. */
export function bestValue(facts: FactRow[], field: string): FactRow | null {
  const rows = facts.filter((f) => f.field === field);
  if (!rows.length) return null;
  const rank = (r: FactRow) => (r.source_type === 'usuario' ? 0 : r.source_type === 'document' ? 1 : r.is_internal ? 3 : 2);
  return rows.slice().sort((a, b) => rank(a) - rank(b))[0];
}

/** Referencia catastral: solo letras y números; 18 caracteres (finca + inmueble), sin los 2 de control. */
export function normalizeCadastral(v: string): string {
  return v.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, 18);
}

const FLOOR_WORDS: [RegExp, string][] = [
  [/\b(bajo|planta baja|pb)\b/, '0'],
  [/\b(entresuelo|entreplanta)\b/, 'E'],
  [/\b(principal|ppal)\b/, 'P'],
  [/\batico\b/, 'AT'],
  [/\bprimer[oa]?\b/, '1'],
  [/\bsegund[oa]\b/, '2'],
  [/\btercer[oa]?\b/, '3'],
  [/\bcuart[oa]\b/, '4'],
  [/\bquint[oa]\b/, '5'],
  [/\bsext[oa]\b/, '6'],
  [/\bseptim[oa]\b/, '7'],
  [/\boctav[oa]\b/, '8'],
  [/\bnoven[oa]\b/, '9'],
];

/**
 * Planta normalizada a "número + puerta": "4º izquierda", "cuarto izq.", "4º IZQ (según el plano)" → "4|IZQ".
 * Si una fuente no indica la puerta, solo se compara el número. Devuelve '' si no se reconoce.
 */
export function normalizeFloor(v: string): string {
  let s = v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ');
  let num = /(\d+)\s*[ºª°o]?/.exec(s)?.[1] ?? '';
  if (!num) for (const [re, n] of FLOOR_WORDS) if (re.test(s)) { num = n; break; }
  s = s.replace(/\bsin ascensor\b|\bcon ascensor\b/g, ' ');
  const door = /\b(izq|izda|izquierda)\b/.test(s)
    ? 'IZQ'
    : /\b(dcha|dch|drcha|derecha)\b/.test(s)
      ? 'DCHA'
      : /\b(centro|ctro)\b/.test(s)
        ? 'CTRO'
        : (/\d+\s*[ºª°]?\s*-?\s*([a-h])\b/.exec(s)?.[1] ?? /\b(?:puerta|letra)\s+([a-h])\b/.exec(s)?.[1] ?? '').toUpperCase();
  if (!num) return '';
  return door ? `${num}|${door}` : num;
}
