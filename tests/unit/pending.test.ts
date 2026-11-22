import { describe, expect, it } from 'vitest';
import { computePending, itemsToRequest, type RequiredTemplate, type ReceivedDoc } from '@/agent/pending';

const tpl: RequiredTemplate[] = [
  { id: 't1', label: 'Nota simple', kind: 'documento', match_rule: { doc_type: 'nota_simple' }, required: true, audience: 'cliente', sort: 1 },
  { id: 't2', label: 'Planos del estado actual completos', kind: 'documento', match_rule: { doc_type: 'plano', flag: 'es_estado_actual_completo' }, required: true, audience: 'cliente', sort: 2 },
  { id: 't3', label: 'Fotos (mín. 4)', kind: 'documento', match_rule: { doc_type: 'foto', min: 4 }, required: true, audience: 'cliente', sort: 3 },
  { id: 't4', label: 'Certificado energético', kind: 'documento', match_rule: { doc_type: 'certificado', subtype: 'eficiencia_energetica' }, required: true, audience: 'cliente', sort: 4 },
  { id: 't5', label: 'Teléfono', kind: 'dato', match_rule: { fact: 'client.phone' }, required: true, audience: 'cliente', sort: 5 },
  { id: 't6', label: 'Normas de comunidad', kind: 'documento', match_rule: { doc_type: 'otro', subtype: 'normas_comunidad' }, required: false, audience: 'cliente', sort: 6 },
];
const foto = (id: string, status = 'ok'): ReceivedDoc => ({ id, doc_type: 'foto', status, extracted: {} });

describe('computePending', () => {
  it('encargo completo: no queda nada obligatorio pendiente', () => {
    const docs: ReceivedDoc[] = [
      { id: 'n', doc_type: 'nota_simple', status: 'ok', extracted: {} },
      { id: 'p', doc_type: 'plano', status: 'ok', extracted: { plano: { es_estado_actual: true, completo: true, legible: true } } },
      foto('f1'), foto('f2'), foto('f3'), foto('f4'),
      { id: 'c', doc_type: 'certificado', status: 'ok', extracted: { subtipo: 'eficiencia_energetica' } },
    ];
    const r = itemsToRequest(computePending(tpl, docs, [{ field: 'client.phone', value: '+34612345678' }]));
    expect(r.required).toHaveLength(0);
    expect(r.optional.map((o) => o.templateId)).toEqual(['t6']);
  });

  it('encargo con documentos faltantes: plano incompleto, fotos insuficientes y duplicados que no cuentan', () => {
    const docs: ReceivedDoc[] = [
      { id: 'p', doc_type: 'plano', status: 'ok', extracted: { plano: { es_estado_actual: true, completo: false, legible: true } } },
      foto('f1'), foto('f2'), foto('f3'), foto('f3b', 'duplicado'),
    ];
    const res = computePending(tpl, docs, []);
    const req = itemsToRequest(res).required.map((r) => r.templateId);
    expect(req).toEqual(['t1', 't2', 't3', 't4', 't5']);
    expect(res.find((r) => r.templateId === 't2')?.note).toMatch(/no está completo/);
    expect(res.find((r) => r.templateId === 't3')?.note).toBe('Recibidas 3 de 4');
  });
});
