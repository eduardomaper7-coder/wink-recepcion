import { describe, expect, it } from 'vitest';
import { isTechnicalUpdate } from '@/agent/analysis';

describe('actualización técnica del personal', () => {
  it('un "ok" o un aviso corto no rehace el expediente', () => {
    expect(isTechnicalUpdate('ok', 0)).toBe(false);
    expect(isTechnicalUpdate('Llego en 10 minutos a la visita', 0)).toBe(false);
  });
  it('notas de visita o fotos nuevas sí', () => {
    expect(isTechnicalUpdate('El tabique entre cocina y salón es de ladrillo hueco, no parece de carga. Cuadro eléctrico sin diferencial.', 0)).toBe(true);
    expect(isTechnicalUpdate('', 3)).toBe(true);
  });
});
