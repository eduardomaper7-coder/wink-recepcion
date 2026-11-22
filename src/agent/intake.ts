/**
 * Identificación del remitente y del origen del encargo (lógica pura y testeable).
 * Reglas de negocio:
 *  - Reenvío del personal: el cliente es el remitente original; responsable = quien reenvía.
 *  - Encargo escrito por el personal: responsable = quien escribe; si falta email/teléfono
 *    del cliente se pide primero a esa persona de Wink.
 *  - Personal en copia de una respuesta a un cliente: cliente = destinatario externo.
 *  - Cliente directo: sin responsable (lo asigna un administrador).
 */
import type { NormalizedEmail } from '@/email/types';
import { detectForward, type ForwardedOriginal } from '@/email/heuristics';
import type { StaffMember } from '@/core/settings';

export type Origin = 'cliente_directo' | 'reenvio_personal' | 'encargo_personal' | 'cc_personal' | 'whatsapp';

export interface SenderIdentity {
  senderType: 'cliente' | 'personal' | 'sistema' | 'desconocido';
  staff: StaffMember | null;
  origin: Origin;
  /** Candidato a cliente detectado sin LLM (el LLM puede completarlo) */
  clientCandidate: { name: string | null; email: string | null };
  forwarded: ForwardedOriginal | null;
  responsibleStaffId: string | null;
}

export function isInternalAddress(email: string, internalDomains: string[], staff: StaffMember[], agentMailbox: string): boolean {
  const e = email.toLowerCase();
  if (e === agentMailbox.toLowerCase()) return false;
  if (staff.some((s) => s.email.toLowerCase() === e)) return true;
  const domain = e.split('@')[1] ?? '';
  return internalDomains.some((d) => domain === d.toLowerCase().replace(/^@/, ''));
}

export function findStaff(email: string, staff: StaffMember[]): StaffMember | null {
  return staff.find((s) => s.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export function identifySender(
  email: Pick<NormalizedEmail, 'from' | 'to' | 'cc' | 'subject' | 'text'>,
  ctx: { internalDomains: string[]; staff: StaffMember[]; agentMailbox: string },
): SenderIdentity {
  const agent = ctx.agentMailbox.toLowerCase();
  const fromEmail = email.from.email.toLowerCase();

  if (fromEmail === agent) {
    return {
      senderType: 'sistema',
      staff: null,
      origin: 'cliente_directo',
      clientCandidate: { name: null, email: null },
      forwarded: null,
      responsibleStaffId: null,
    };
  }

  const internal = isInternalAddress(fromEmail, ctx.internalDomains, ctx.staff, ctx.agentMailbox);
  if (!internal) {
    return {
      senderType: 'cliente',
      staff: null,
      origin: 'cliente_directo',
      clientCandidate: { name: email.from.name ?? null, email: fromEmail },
      forwarded: null,
      responsibleStaffId: null,
    };
  }

  const staff = findStaff(fromEmail, ctx.staff);
  const forwarded = detectForward(email.subject, email.text);
  const isExternal = (a: { email: string }) =>
    a.email.toLowerCase() !== agent && !isInternalAddress(a.email, ctx.internalDomains, ctx.staff, ctx.agentMailbox);

  if (forwarded) {
    const fwdEmail = forwarded.fromEmail && isExternal({ email: forwarded.fromEmail }) ? forwarded.fromEmail : null;
    return {
      senderType: 'personal',
      staff,
      origin: 'reenvio_personal',
      clientCandidate: { name: forwarded.fromName, email: fwdEmail },
      forwarded,
      responsibleStaffId: staff?.id ?? null,
    };
  }

  // Personal que responde a un cliente y pone el buzón de encargos en copia
  const externalRecipients = [...email.to, ...email.cc].filter(isExternal);
  const agentInCc = email.cc.some((a) => a.email.toLowerCase() === agent);
  if (agentInCc && externalRecipients.length > 0) {
    const c = externalRecipients[0];
    return {
      senderType: 'personal',
      staff,
      origin: 'cc_personal',
      clientCandidate: { name: c.name ?? null, email: c.email.toLowerCase() },
      forwarded: null,
      responsibleStaffId: staff?.id ?? null,
    };
  }

  return {
    senderType: 'personal',
    staff,
    origin: 'encargo_personal',
    clientCandidate: { name: null, email: externalRecipients[0]?.email.toLowerCase() ?? null },
    forwarded: null,
    responsibleStaffId: staff?.id ?? null,
  };
}

/** ¿Hay que pedir primero los datos de contacto a la persona de Wink? */
export function needsInternalContactRequest(origin: Origin, client: { email: string | null; phone: string | null }): boolean {
  if (origin === 'cliente_directo' || origin === 'whatsapp') return false;
  return !client.email || !client.phone;
}

/** Para el correo al cliente hace falta al menos su email. */
export function canContactClient(client: { email: string | null }): boolean {
  return !!client.email;
}

/**
 * Remitente por WhatsApp: el personal se reconoce por su móvil (ficha de personal);
 * cualquier otro número es un cliente.
 */
export function identifyWhatsAppSender(phone: string | null, name: string | null, staff: StaffMember[]): SenderIdentity {
  const member = phone ? (staff.find((s) => s.phone && s.phone.replace(/[^+\d]/g, '') === phone) ?? null) : null;
  if (member) {
    return { senderType: 'personal', staff: member, origin: 'whatsapp', clientCandidate: { name: null, email: null }, forwarded: null, responsibleStaffId: member.id };
  }
  return { senderType: 'cliente', staff: null, origin: 'whatsapp', clientCandidate: { name, email: null }, forwarded: null, responsibleStaffId: null };
}
