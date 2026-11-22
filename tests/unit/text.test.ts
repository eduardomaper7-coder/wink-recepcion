import { describe, expect, it } from 'vitest';
import { normalizeAddress, normalizePhone, parseSpanishNumber, slugify } from '@/lib/text';

describe('utilidades de texto', () => {
  it('normaliza direcciones', () => expect(normalizeAddress('C/ Ibiza, 23 - 3ºB, 28009 Madrid')).toBe(normalizeAddress('calle Ibiza 23 3 B')));
  it('normaliza teléfonos españoles', () => {
    expect(normalizePhone('612 34 56 78')).toBe('+34612345678');
    expect(normalizePhone('0034 612345678')).toBe('+34612345678');
  });
  it('lee números en formato español', () => {
    expect(parseSpanishNumber('82,40 m²')).toBe(82.4);
    expect(parseSpanishNumber('1.250,5')).toBe(1250.5);
    expect(parseSpanishNumber('unos 95 m2')).toBe(95);
    expect(parseSpanishNumber('1962')).toBe(1962);
    expect(parseSpanishNumber('construido en 1958.')).toBe(1958);
    expect(parseSpanishNumber('82.4')).toBe(82.4);
    expect(parseSpanishNumber('90.000-100.000 €')).toBe(90000);
  });
  it('slugify', () => expect(slugify('Baño principal – estado actual')).toBe('bano-principal-estado-actual'));
});
