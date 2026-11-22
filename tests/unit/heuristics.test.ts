import { describe, expect, it } from 'vitest';
import { cleanBody, detectForward, isAutoReply, threadIds } from '@/email/heuristics';

describe('detectForward', () => {
  it('extrae el remitente original de un reenvío de Gmail en español', () => {
    const text = `Te paso lo de esta clienta, la llamé ayer y tiene prisa.\n\n---------- Mensaje reenviado ---------\nDe: Lucía Fernández <lucia.fernandez.demo@gmail.com>\nDate: lun, 16 nov 2026 a las 9:12\nSubject: Reforma piso Ibiza\nTo: <laura.martin@winkgroup.es>\n\nHola Laura, os escribo por el piso...`;
    const f = detectForward('Fwd: Reforma piso Ibiza', text)!;
    expect(f.fromEmail).toBe('lucia.fernandez.demo@gmail.com');
    expect(f.fromName).toBe('Lucía Fernández');
    expect(f.subject).toBe('Reforma piso Ibiza');
    expect(f.forwarderNote).toContain('tiene prisa');
    expect(f.body).toContain('os escribo por el piso');
  });

  it('entiende el formato de Outlook con [mailto:]', () => {
    const text = `Nota interna.\n________________________________\nDe: Pedro Gil [mailto:pedro.gil@hotmail.com]\nEnviado el: martes, 17 de noviembre de 2026 10:00\nPara: Laura\nAsunto: Presupuesto reforma\n\nBuenos días...`;
    const f = detectForward('RV: Presupuesto reforma', text)!;
    expect(f.fromEmail).toBe('pedro.gil@hotmail.com');
    expect(f.fromName).toBe('Pedro Gil');
  });

  it('devuelve null si no es un reenvío', () => {
    expect(detectForward('Reforma cocina', 'Hola, quiero reformar la cocina.')).toBeNull();
  });
});

describe('isAutoReply', () => {
  const base = { from: { email: 'x@y.com' }, subject: 'Hola' };
  it('detecta Auto-Submitted', () => expect(isAutoReply({ ...base, headers: { 'auto-submitted': 'auto-replied' } })).toBe(true));
  it('detecta "Fuera de la oficina" en el asunto', () => expect(isAutoReply({ ...base, subject: 'Fuera de la oficina: vuelvo el lunes', headers: {} })).toBe(true));
  it('detecta newsletters por List-Id', () => expect(isAutoReply({ ...base, headers: { 'list-id': '<news.x.com>' } })).toBe(true));
  it('no marca un correo normal', () => expect(isAutoReply({ ...base, headers: { 'auto-submitted': 'no' } })).toBe(false));
});

describe('cleanBody', () => {
  it('quita el texto citado y el aviso legal pero conserva la firma aparte', () => {
    const t = `Os adjunto la nota simple.\n\nUn saludo,\nLucía\n612 345 678\n\nAVISO LEGAL: este mensaje es confidencial y va dirigido...\n\nEl lun, 16 nov 2026 a las 9:12, Wink escribió:\n> Necesitamos la nota simple`;
    const r = cleanBody(t);
    expect(r.main).toBe('Os adjunto la nota simple.');
    expect(r.signature).toContain('612 345 678');
    expect(r.signature).not.toContain('AVISO LEGAL');
    expect(r.main).not.toContain('Necesitamos');
  });
});

describe('threadIds', () => {
  it('prioriza In-Reply-To y luego References del más reciente al más antiguo', () => {
    expect(threadIds({ inReplyTo: '<c@x>', references: ['<a@x>', '<b@x>', '<c@x>'] })).toEqual(['<c@x>', '<b@x>', '<a@x>']);
  });
});
