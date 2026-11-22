import { describe, expect, it } from 'vitest';
import { detectInconsistencies, bestValue, normalizeFloor, type FactRow } from '@/agent/facts';

const f = (o: Partial<FactRow>): FactRow => ({ id: Math.random().toString(), field: 'x', value: '', value_num: null, source_type: 'email', source_label: null, is_internal: false, ...o });

describe('incoherencias entre cliente y documentos', () => {
  it('superficie: 95 m² del cliente frente a 82,40 m² de la nota simple', () => {
    const r = detectInconsistencies([
      f({ field: 'property.surface_m2', value: 'unos 95 m2', source_label: 'Correo del cliente' }),
      f({ field: 'property.surface_m2', value: '82,40', value_num: 82.4, source_type: 'document', source_label: 'Nota simple' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].description).toContain('Nota simple');
  });
  it('diferencias pequeñas (<3 %) no son incoherencia', () => {
    expect(detectInconsistencies([f({ field: 'property.surface_m2', value: '82' }), f({ field: 'property.surface_m2', value: '82,4', source_type: 'document' })])).toHaveLength(0);
  });
  it('referencia catastral distinta entre fuentes', () => {
    const r = detectInconsistencies([f({ field: 'property.cadastral_ref', value: '9812301VK4791A0012XY' }), f({ field: 'property.cadastral_ref', value: '9812301VK4791A0013ZZ', source_type: 'document' })]);
    expect(r[0].field).toBe('property.cadastral_ref');
  });
  it('el documento prevalece sobre el correo y el correo sobre las notas internas', () => {
    const rows = [f({ field: 'property.surface_m2', value: '90', is_internal: true }), f({ field: 'property.surface_m2', value: '95' }), f({ field: 'property.surface_m2', value: '82,4', source_type: 'document' })];
    expect(bestValue(rows, 'property.surface_m2')?.value).toBe('82,4');
  });
});

describe('planta: mismo significado aunque se escriba distinto', () => {
  it('normaliza variantes', () => {
    expect(normalizeFloor('4º izquierda')).toBe('4|IZQ');
    expect(normalizeFloor('4º izquierda (según rótulo del plano)')).toBe('4|IZQ');
    expect(normalizeFloor('Cuarto izq.')).toBe('4|IZQ');
    expect(normalizeFloor('3º B')).toBe('3|B');
    expect(normalizeFloor('Tercero sin ascensor')).toBe('3');
  });
  it('no marca incoherencia por anotaciones o falta de puerta', () => {
    expect(detectInconsistencies([f({ field: 'property.floor', value: '4º izquierda' }), f({ field: 'property.floor', value: '4º izquierda (según rótulo del plano)', source_type: 'document' })])).toHaveLength(0);
    expect(detectInconsistencies([f({ field: 'property.floor', value: 'cuarta planta' }), f({ field: 'property.floor', value: '4º IZQ', source_type: 'document' })])).toHaveLength(0);
  });
  it('sí la marca si cambia la planta o la puerta', () => {
    expect(detectInconsistencies([f({ field: 'property.floor', value: '4º izquierda' }), f({ field: 'property.floor', value: '3º izquierda', source_type: 'document' })])).toHaveLength(1);
    expect(detectInconsistencies([f({ field: 'property.floor', value: '4º izquierda' }), f({ field: 'property.floor', value: '4º derecha', source_type: 'document' })])).toHaveLength(1);
  });
});
