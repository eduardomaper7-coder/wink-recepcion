/** Selección de plantillas de checklist según el inmueble (lógica pura). */
import { stripAccents } from '@/lib/text';

export interface ChecklistTemplate {
  id: string;
  name: string;
  conditions: { building_year_max?: number; building_year_min?: number; typology?: string[]; rooms_any?: string[] };
  section: string;
  items: string[];
  sort: number;
}

export interface PropertyContext {
  buildingYear: number | null;
  typology: string | null;
  rooms: string[]; // estancias a reformar
}

export interface ChecklistSection {
  section: string;
  items: { text: string; reason: string | null; origin: 'plantilla' | 'agente' | 'usuario'; done?: boolean }[];
}

const norm = (s: string) => stripAccents(s.toLowerCase());

export function templateApplies(t: ChecklistTemplate, p: PropertyContext): boolean {
  const c = t.conditions ?? {};
  if (c.building_year_max !== undefined) {
    if (p.buildingYear === null || p.buildingYear > c.building_year_max) return false;
  }
  if (c.building_year_min !== undefined) {
    if (p.buildingYear === null || p.buildingYear < c.building_year_min) return false;
  }
  if (c.typology?.length) {
    if (!p.typology || !c.typology.map(norm).includes(norm(p.typology))) return false;
  }
  if (c.rooms_any?.length) {
    // Si no sabemos las estancias se incluye (mejor revisar de más en una reforma integral)
    if (p.rooms.length && !p.rooms.some((r) => c.rooms_any!.some((k) => norm(r).includes(norm(k))))) return false;
  }
  return true;
}

export function buildBaseChecklist(templates: ChecklistTemplate[], p: PropertyContext): { sections: ChecklistSection[]; applied: string[] } {
  const applied = templates.filter((t) => templateApplies(t, p)).sort((a, b) => a.sort - b.sort);
  const reasonFor = (t: ChecklistTemplate): string | null => {
    const c = t.conditions ?? {};
    if (c.building_year_max !== undefined) return `Edificio de ${p.buildingYear}`;
    if (c.rooms_any?.length) return 'Estancia incluida en la reforma';
    return null;
  };
  return {
    sections: applied.map((t) => ({
      section: t.section,
      items: t.items.map((text) => ({ text, reason: reasonFor(t), origin: 'plantilla' as const })),
    })),
    applied: applied.map((t) => t.name),
  };
}

export function mergeAgentItems(base: ChecklistSection[], extra: { section: string; text: string; reason: string }[]): ChecklistSection[] {
  const out = base.map((s) => ({ ...s, items: [...s.items] }));
  for (const e of extra) {
    const existing = out.find((s) => norm(s.section) === norm(e.section));
    const item = { text: e.text, reason: e.reason, origin: 'agente' as const };
    if (existing) {
      if (!existing.items.some((i) => norm(i.text) === norm(e.text))) existing.items.push(item);
    } else {
      out.push({ section: e.section, items: [item] });
    }
  }
  return out;
}
