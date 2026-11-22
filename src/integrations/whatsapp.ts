/**
 * Integración con la app de WhatsApp de Wink (dos aplicaciones conectadas por una API interna).
 *
 *   WhatsApp ──► POST /api/integrations/whatsapp/lookup    ¿quién es este teléfono? ¿qué modo de respuesta?
 *   WhatsApp ──► POST /api/integrations/whatsapp/messages  visita reservada · mensaje de cliente · mensaje del personal
 *   WhatsApp ──► POST /api/integrations/whatsapp/mode      cambiar el modo de respuesta de un expediente
 *   Recepción ─► POST {WHATSAPP_APP_URL}/api/integrations/recepcion/send   enviar un borrador aprobado
 *
 * Ambas direcciones se autentican con "Authorization: Bearer INTEGRATION_SECRET" (mismo valor en las dos apps).
 */
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/config/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizePhone } from '@/lib/text';
import type { StaffMember, WaReplyMode, WaReplyModes } from '@/core/settings';

export const WA_MODES: { value: WaReplyMode; label: string; help: string }[] = [
  { value: 'asistente', label: 'Asistente automático', help: 'El asistente de WhatsApp responde solo (sin precios, con aviso de privacidad). Lo técnico sigue pasando por aprobación.' },
  { value: 'borrador', label: 'Borrador con aprobación', help: 'El agente prepara la respuesta y un arquitecto la aprueba antes de enviarla.' },
  { value: 'solo_recibir', label: 'Solo recibir', help: 'No se responde: todo lo que llega se incorpora al expediente.' },
  { value: 'solo_equipo', label: 'Solo equipo', help: 'Contesta una persona a mano desde la bandeja de WhatsApp.' },
];

export function integrationEnabled(): boolean {
  const e = env();
  return !!e.INTEGRATION_SECRET;
}

/** Comprueba el secreto compartido (comparación en tiempo constante). */
export function checkIntegrationAuth(req: Request): boolean {
  const secret = env().INTEGRATION_SECRET;
  if (!secret) return false;
  const got = Buffer.from((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** WhatsApp envía el número sin "+" (wa_id): 34600111222 → +34600111222 */
export function phoneFromWa(waId: string): string | null {
  const digits = waId.replace(/\D/g, '');
  return normalizePhone(`+${digits}`) ?? (digits.length >= 9 ? `+${digits}` : null);
}

export type ContactKind = 'personal' | 'cliente_con_expediente' | 'cliente' | 'desconocido';

export interface LookupResult {
  kind: ContactKind;
  staff: { id: string; name: string } | null;
  client: { id: string; name: string | null; email: string | null } | null;
  project: { id: string; code: string; title: string | null; status: string; url: string } | null;
  /** Modo de respuesta efectivo y de dónde sale */
  mode: WaReplyMode;
  modeSource: 'expediente' | 'ajustes';
  /** Solo para el personal: expedientes entre los que elegir (visitas próximas y asignados) */
  projectOptions: { id: string; code: string; title: string | null; visitAt: string | null }[];
}

/** Modo efectivo: el del expediente si lo tiene; si no, el de Ajustes según el tipo de contacto. */
export function resolveMode(kind: ContactKind, modes: WaReplyModes, projectMode: WaReplyMode | null): { mode: WaReplyMode; source: 'expediente' | 'ajustes' } {
  if (kind === 'personal') return { mode: modes.personal, source: 'ajustes' };
  if (projectMode) return { mode: projectMode, source: 'expediente' };
  return { mode: kind === 'cliente_con_expediente' ? modes.cliente_con_expediente : modes.cliente_nuevo, source: 'ajustes' };
}

export function findStaffByPhone(phone: string | null, staff: StaffMember[]): StaffMember | null {
  if (!phone) return null;
  return staff.find((s) => s.phone && normalizePhone(s.phone) === phone) ?? null;
}

const ACTIVE = ['procesando', 'esperando_datos_internos', 'pendiente_revision', 'esperando_cliente', 'listo_para_visita', 'visita_agendada'];

/** Expediente activo más reciente de un cliente por WhatsApp (por conversación o por teléfono). */
export async function findProjectForWhatsApp(opts: { waConversationId?: string | null; phone?: string | null }) {
  const sb = supabaseAdmin();
  if (opts.waConversationId) {
    const { data } = await sb
      .from('projects')
      .select('id,code,title,status,wa_reply_mode,client_id')
      .eq('wa_conversation_id', opts.waConversationId)
      .in('status', ACTIVE)
      .is('merged_into_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data;
  }
  if (opts.phone) {
    const { data: clients } = await sb.from('clients').select('id').eq('phone', opts.phone);
    const ids = (clients ?? []).map((c) => c.id);
    if (ids.length) {
      const { data } = await sb
        .from('projects')
        .select('id,code,title,status,wa_reply_mode,client_id')
        .in('client_id', ids)
        .in('status', ACTIVE)
        .is('merged_into_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return data;
    }
  }
  return null;
}

/** Expedientes entre los que puede elegir una persona del equipo: visitas de hoy en adelante y asignados. */
export async function projectOptionsForStaff(staffId: string) {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  // Todos los expedientes activos; primero los suyos y los que tienen visita próxima, luego los más recientes
  const { data } = await sb
    .from('projects')
    .select('id,code,title,visit_at,responsible_staff_id,status,updated_at')
    .in('status', ACTIVE)
    .is('merged_into_id', null)
    .order('updated_at', { ascending: false })
    .limit(30);
  const score = (p: { responsible_staff_id: string | null; visit_at: string | null }) =>
    (p.responsible_staff_id === staffId ? 2 : 0) + (p.visit_at && p.visit_at >= since ? 1 : 0);
  return [...(data ?? [])]
    .sort((a, b) => score(b) - score(a))
    .map((p) => ({ id: p.id, code: p.code, title: p.title, visitAt: p.visit_at }));
}

/** Envía un texto aprobado a la conversación de WhatsApp (a través de la app de WhatsApp). */
export async function sendViaWhatsApp(input: { conversationId: string; text: string; clientRef: string; approvedBy: string | null }) {
  const e = env();
  if (!e.WHATSAPP_APP_URL || !e.INTEGRATION_SECRET) throw new Error('La integración con WhatsApp no está configurada (WHATSAPP_APP_URL e INTEGRATION_SECRET)');
  const res = await fetch(`${e.WHATSAPP_APP_URL.replace(/\/$/, '')}/api/integrations/recepcion/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${e.INTEGRATION_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as { messageId?: string; error?: string; code?: string };
  if (!res.ok) {
    if (body.code === 'window_closed')
      throw new Error('No se puede enviar por WhatsApp: el cliente no ha escrito en las últimas 24 h (regla de Meta). Envíalo por correo o usa una plantilla desde la bandeja de WhatsApp.');
    throw new Error(`WhatsApp rechazó el envío: ${body.error ?? res.status}`);
  }
  return { messageId: body.messageId ?? input.clientRef };
}

export function whatsappConversationUrl(conversationId: string | null): string | null {
  const base = env().WHATSAPP_APP_URL;
  return base && conversationId ? `${base.replace(/\/$/, '')}/inbox/${conversationId}` : null;
}
