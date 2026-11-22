import { describe, expect, it } from 'vitest';
import { resolveMode, phoneFromWa, findStaffByPhone } from '@/integrations/whatsapp';
import { identifyWhatsAppSender, needsInternalContactRequest } from '@/agent/intake';
import type { StaffMember } from '@/core/settings';

const modes = { cliente_nuevo: 'asistente', cliente_con_expediente: 'borrador', personal: 'solo_recibir' } as const;
const staff: StaffMember[] = [{ id: 's1', full_name: 'Laura Martín', email: 'laura@winkgroup.es', role: 'arquitecto', active: true, phone: '+34600111222' }];

describe('WhatsApp · modo de respuesta', () => {
  it('cliente nuevo → modo de Ajustes para captación', () => expect(resolveMode('desconocido', modes, null)).toEqual({ mode: 'asistente', source: 'ajustes' }));
  it('cliente con expediente → modo de Ajustes para clientes con expediente', () => expect(resolveMode('cliente_con_expediente', modes, null).mode).toBe('borrador'));
  it('el modo propio del expediente manda sobre Ajustes', () => expect(resolveMode('cliente_con_expediente', modes, 'solo_equipo')).toEqual({ mode: 'solo_equipo', source: 'expediente' }));
  it('el personal siempre usa su modo (el asistente no le responde como a un cliente)', () => expect(resolveMode('personal', modes, 'asistente').mode).toBe('solo_recibir'));
});

describe('WhatsApp · quién escribe', () => {
  it('convierte el wa_id de Meta en teléfono E.164', () => {
    expect(phoneFromWa('34600111222')).toBe('+34600111222');
    expect(phoneFromWa('447700900123')).toBe('+447700900123');
  });
  it('reconoce al personal por su móvil', () => {
    expect(findStaffByPhone('+34600111222', staff)?.id).toBe('s1');
    const id = identifyWhatsAppSender('+34600111222', 'Laura', staff);
    expect(id.senderType).toBe('personal');
    expect(id.responsibleStaffId).toBe('s1');
  });
  it('cualquier otro número es un cliente, sin exigir email', () => {
    const id = identifyWhatsAppSender('+34699999999', 'Eduardo', staff);
    expect(id.senderType).toBe('cliente');
    expect(id.origin).toBe('whatsapp');
    expect(needsInternalContactRequest('whatsapp', { email: null, phone: '+34699999999' })).toBe(false);
  });
});
