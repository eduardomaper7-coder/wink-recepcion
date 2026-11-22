import { describe, expect, it } from 'vitest';
import { identifySender, needsInternalContactRequest } from '@/agent/intake';
import type { StaffMember } from '@/core/settings';

const staff: StaffMember[] = [{ id: 's1', full_name: 'Laura Martín', email: 'laura.martin@winkgroup.es', role: 'arquitecto', active: true }];
const ctx = { internalDomains: ['winkgroup.es'], staff, agentMailbox: 'prueba@aibetech.es' };
const to = [{ email: 'prueba@aibetech.es' }];

describe('identifySender — los escenarios de "quién envía el correo"', () => {
  it('cliente directo: sin responsable asignado', () => {
    const r = identifySender({ from: { email: 'ana@gmail.com', name: 'Ana' }, to, cc: [], subject: 'Reforma', text: 'Hola' }, ctx);
    expect(r.origin).toBe('cliente_directo');
    expect(r.senderType).toBe('cliente');
    expect(r.responsibleStaffId).toBeNull();
    expect(r.clientCandidate.email).toBe('ana@gmail.com');
  });

  it('reenvío del personal: el cliente es el remitente original y el responsable quien reenvía', () => {
    const text = `Mira esto\n\n---------- Forwarded message ---------\nFrom: Lucía Fernández <lucia@gmail.com>\nSubject: Piso\n\nHola`;
    const r = identifySender({ from: { email: 'laura.martin@winkgroup.es' }, to, cc: [], subject: 'Fwd: Piso', text }, ctx);
    expect(r.origin).toBe('reenvio_personal');
    expect(r.clientCandidate.email).toBe('lucia@gmail.com');
    expect(r.responsibleStaffId).toBe('s1');
  });

  it('encargo escrito por el personal sin email del cliente: hay que pedírselo primero al personal', () => {
    const r = identifySender({ from: { email: 'laura.martin@winkgroup.es' }, to, cc: [], subject: 'Nuevo encargo', text: 'He hablado con Jorge...' }, ctx);
    expect(r.origin).toBe('encargo_personal');
    expect(r.clientCandidate.email).toBeNull();
    expect(needsInternalContactRequest(r.origin, { email: null, phone: '+34600000000' })).toBe(true);
  });

  it('personal en copia de una respuesta a un cliente', () => {
    const r = identifySender(
      { from: { email: 'laura.martin@winkgroup.es' }, to: [{ email: 'jorge@yahoo.es', name: 'Jorge' }], cc: [{ email: 'prueba@aibetech.es' }], subject: 'Re: visita', text: 'Gracias Jorge' },
      ctx,
    );
    expect(r.origin).toBe('cc_personal');
    expect(r.clientCandidate.email).toBe('jorge@yahoo.es');
    expect(r.responsibleStaffId).toBe('s1');
  });

  it('un dominio interno sin ficha de personal se reconoce como personal', () => {
    const r = identifySender({ from: { email: 'nuevo@winkgroup.es' }, to, cc: [], subject: 'x', text: 'y' }, ctx);
    expect(r.senderType).toBe('personal');
    expect(r.staff).toBeNull();
  });

  it('los correos del propio buzón del agente se ignoran', () => {
    const r = identifySender({ from: { email: 'prueba@aibetech.es' }, to, cc: [], subject: 'x', text: 'y' }, ctx);
    expect(r.senderType).toBe('sistema');
  });
});
