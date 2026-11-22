import { describe, expect, it } from 'vitest';
import { buildBaseChecklist, mergeAgentItems, type ChecklistTemplate } from '@/agent/checklist';

const tpl: ChecklistTemplate[] = [
  { id: '1', name: 'General', conditions: {}, section: 'General', items: ['Medir estancias'], sort: 1 },
  { id: '2', name: 'Antiguo', conditions: { building_year_max: 1959 }, section: 'Edificio antiguo', items: ['Revisar forjados', 'Revisar bajantes', 'Posible amianto'], sort: 2 },
  { id: '3', name: 'Cocina', conditions: { rooms_any: ['cocina'] }, section: 'Cocina', items: ['Salida de humos'], sort: 3 },
];

describe('checklist por plantillas', () => {
  it('edificio de 1958 → forjados, bajantes y amianto', () => {
    const r = buildBaseChecklist(tpl, { buildingYear: 1958, typology: 'piso', rooms: ['cocina', 'baños'] });
    const all = r.sections.flatMap((s) => s.items.map((i) => i.text));
    expect(all).toEqual(expect.arrayContaining(['Revisar forjados', 'Revisar bajantes', 'Posible amianto', 'Salida de humos']));
    expect(r.sections.find((s) => s.section === 'Edificio antiguo')?.items[0].reason).toBe('Edificio de 1958');
  });

  it('edificio de 1995 sin cocina en la reforma → solo lo general', () => {
    const r = buildBaseChecklist(tpl, { buildingYear: 1995, typology: 'piso', rooms: ['dormitorio'] });
    expect(r.applied).toEqual(['General']);
  });

  it('los ítems del agente se añaden sin duplicar', () => {
    const base = buildBaseChecklist(tpl, { buildingYear: 1995, typology: null, rooms: [] }).sections;
    const merged = mergeAgentItems(base, [
      { section: 'General', text: 'medir estancias', reason: 'x' },
      { section: 'Humedades', text: 'Revisar mancha del techo del baño', reason: 'Foto 3' },
    ]);
    expect(merged.find((s) => s.section === 'General')?.items).toHaveLength(1);
    expect(merged.find((s) => s.section === 'Humedades')?.items[0].origin).toBe('agente');
  });
});
