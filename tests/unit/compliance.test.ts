import { describe, expect, it } from 'vitest';
import { checkClientEmail } from '@/agent/compliance';

describe('checkClientEmail — nada de precios, viabilidad, plazos de obra ni normativa', () => {
  it('detecta precios', () => expect(checkClientEmail('La reforma rondará los 45.000 € aproximadamente').map((f) => f.code)).toContain('precio'));
  it('detecta opiniones de viabilidad', () => expect(checkClientEmail('Abrir la cocina es perfectamente viable').map((f) => f.code)).toContain('viabilidad'));
  it('detecta plazos de obra', () => expect(checkClientEmail('La obra durará unas 10 semanas').map((f) => f.code)).toContain('plazo_obra'));
  it('detecta opiniones normativas', () => expect(checkClientEmail('Esta actuación no necesitará licencia').map((f) => f.code)).toContain('normativa'));
  it('detecta notas internas copiadas literalmente', () => {
    const notes = 'El cliente parece indeciso y probablemente pida descuento al final del proceso.';
    expect(checkClientEmail('Hola. El cliente parece indeciso y probablemente pida descuento al final del proceso.', notes).map((f) => f.code)).toContain('nota_interna');
  });
  it('un correo correcto no genera avisos', () => {
    expect(checkClientEmail('Buenos días, Lucía: gracias por contactar con Wink. Para avanzar necesitamos la nota simple. ¿Le viene bien el martes a las 10:00?')).toEqual([]);
  });
});

import { clientSafe } from '@/lib/text';
describe('anotaciones internas fuera de los correos al cliente', () => {
  it('quita las aclaraciones de trabajo y conserva el resto', () => {
    expect(clientSafe('Rodríguez San Pedro 48, 4º izq., Chamberí (según correo; no consta en la foto)')).toBe('Rodríguez San Pedro 48, 4º izq., Chamberí');
    expect(clientSafe('4º izquierda (según rótulo del plano)')).toBe('4º izquierda');
    expect(clientSafe('Hola:\n\nLínea dos (planta baja)')).toBe('Hola:\n\nLínea dos (planta baja)');
  });
  it('el control de cumplimiento las detecta', () => {
    expect(checkClientEmail('Visita en Calle X 4 (según correo; no consta en la foto) el martes').map((f) => f.code)).toContain('nota_interna');
  });
});

import { stripClosing } from '@/agent/drafts';
describe('despedida duplicada', () => {
  it('quita la despedida del modelo si la firma ya la trae', () => {
    const body = 'Estimada Lucía:\n\nTexto.\n\nQuedamos a su disposición.\n\nUn cordial saludo.';
    expect(stripClosing(body, 'Un saludo,\nEquipo Wink Group')).toBe('Estimada Lucía:\n\nTexto.\n\nQuedamos a su disposición.');
  });
});
