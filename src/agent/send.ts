/**
 * Envío de un borrador. Único punto por el que sale correo del sistema.
 * - Si el borrador requiere aprobación, exige un usuario aprobador (arquitecto/admin).
 * - Responde dentro del hilo (In-Reply-To / References) cuando existe.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { emailProvider } from '@/email/providers';
import { env } from '@/config/env';
import { audit } from '@/core/audit';
import { hasInternalNote, normalizeSubject } from '@/lib/text';
import { sendViaWhatsApp } from '@/integrations/whatsapp';

export class ApprovalRequiredError extends Error {
  constructor() {
    super('Este correo requiere la aprobación de un arquitecto antes de enviarse');
  }
}

export async function sendDraft(draftId: string, approverUserId: string | null): Promise<{ emailId: string; redirected: boolean }> {
  const sb = supabaseAdmin();
  const { data: draft, error } = await sb.from('email_drafts').select('*').eq('id', draftId).single();
  if (error || !draft) throw new Error('Borrador no encontrado');
  if (draft.status === 'enviado') throw new Error('Este borrador ya se envió');
  if (draft.status === 'descartado') throw new Error('Este borrador está descartado');
  if (draft.requires_approval && !approverUserId) throw new ApprovalRequiredError();
  const viaWhatsApp = draft.channel === 'whatsapp';
  if (viaWhatsApp && !draft.wa_conversation_id) throw new Error('El borrador de WhatsApp no tiene conversación asociada');
  if (!viaWhatsApp && !draft.to_emails?.length) throw new Error('El borrador no tiene destinatario');
  const isInternalKind = draft.kind === 'solicitud_interna' || draft.kind === 'aviso_interno';
  if (!isInternalKind) {
    const note = hasInternalNote(`${draft.subject}\n${draft.body_text}`);
    if (note) throw new Error(`El correo contiene una anotación interna que no debe ver el cliente: «${note}». Quítala y vuelve a enviar.`);
  }

  const { data: project } = await sb.from('projects').select('id,code').eq('id', draft.project_id).single();

  let sentEmailId: string;
  let redirected = false;
  if (viaWhatsApp) {
    const r = await sendViaWhatsApp({ conversationId: draft.wa_conversation_id, text: draft.body_text, clientRef: `draft:${draftId}`, approvedBy: approverUserId });
    const { data: sent, error: insErr } = await sb
      .from('emails')
      .insert({
        direction: 'saliente',
        provider: 'whatsapp',
        provider_message_id: r.messageId,
        channel: 'whatsapp',
        wa_conversation_id: draft.wa_conversation_id,
        project_id: draft.project_id,
        from_name: 'Wink Group (WhatsApp)',
        subject: draft.subject,
        body_text: draft.body_text,
        sent_at: new Date().toISOString(),
        sender_type: 'sistema',
        classification: 'sin_clasificar',
        processing_status: 'procesado',
        approved_by: approverUserId,
      })
      .select('id')
      .single();
    if (insErr) throw new Error(`Enviado por WhatsApp pero no registrado: ${insErr.message}`);
    sentEmailId = sent.id;
    await sb
      .from('email_drafts')
      .update({ status: 'enviado', sent_email_id: sent.id, approved_by: approverUserId, approved_at: approverUserId ? new Date().toISOString() : null })
      .eq('id', draftId);
  } else {
    const out = await sendByEmail();
    sentEmailId = out.id;
    redirected = out.redirected;
  }

  async function sendByEmail(): Promise<{ id: string; redirected: boolean }> {
    // Hilo: último mensaje del expediente con el cliente (para que vea todo junto)
    let inReplyTo: string | null = null;
    let references: string[] = [];
    let threadId: string | null = null;
    const isInternal = draft.kind === 'solicitud_interna' || draft.kind === 'aviso_interno';
    if (draft.in_reply_to_email_id) {
      const { data: parent } = await sb.from('emails').select('message_id_header,references_ids,thread_id').eq('id', draft.in_reply_to_email_id).single();
      if (parent?.message_id_header) {
        inReplyTo = parent.message_id_header;
        references = [...(parent.references_ids ?? []), parent.message_id_header];
        threadId = parent.thread_id;
      }
    } else if (!isInternal) {
      // Último mensaje con ESTE destinatario (nunca un correo interno del equipo)
      const recipients = new Set(draft.to_emails.map((x: string) => x.toLowerCase()));
      const { data: candidates } = await sb
        .from('emails')
        .select('message_id_header,references_ids,thread_id,from_email,to_emails,direction')
        .eq('project_id', draft.project_id)
        .not('message_id_header', 'is', null)
        .order('created_at', { ascending: false })
        .limit(30);
      const last = (candidates ?? []).find(
        (m) =>
          (m.direction === 'entrante' && recipients.has(String(m.from_email).toLowerCase())) ||
          (m.direction === 'saliente' && (m.to_emails ?? []).some((t: string) => recipients.has(t.toLowerCase()))),
      );
      if (last?.message_id_header) {
        inReplyTo = last.message_id_header;
        references = [...(last.references_ids ?? []), last.message_id_header];
        threadId = last.thread_id;
      }
    }

    const e = env();
    const result = await emailProvider().send({
      from: { email: e.AGENT_MAILBOX, name: e.AGENT_DISPLAY_NAME },
      to: draft.to_emails.map((x: string) => ({ email: x })),
      cc: (draft.cc_emails ?? []).map((x: string) => ({ email: x })),
      subject: draft.subject,
      text: draft.body_text,
      inReplyTo,
      references: references.slice(-20),
    });

    if (!threadId && !isInternal) {
      const { data: t } = await sb
        .from('email_threads')
        .insert({ project_id: draft.project_id, root_message_id: result.messageId, subject_norm: normalizeSubject(draft.subject) })
        .select('id')
        .single();
      threadId = t?.id ?? null;
    }

    const { data: sent, error: insErr } = await sb
      .from('emails')
      .insert({
        direction: 'saliente',
        provider: emailProvider().name,
        provider_message_id: result.providerMessageId,
        message_id_header: result.messageId,
        in_reply_to: inReplyTo,
        references_ids: references,
        thread_id: threadId,
        project_id: draft.project_id,
        from_email: e.AGENT_MAILBOX,
        from_name: e.AGENT_DISPLAY_NAME,
        to_emails: draft.to_emails,
        cc_emails: draft.cc_emails ?? [],
        subject: draft.subject,
        body_text: draft.body_text,
        sent_at: new Date().toISOString(),
        sender_type: 'sistema',
        classification: 'sin_clasificar',
        processing_status: 'procesado',
        approved_by: approverUserId,
      })
      .select('id')
      .single();
    if (insErr) throw new Error(`Enviado pero no registrado: ${insErr.message}`);

    await sb
      .from('email_drafts')
      .update({ status: 'enviado', sent_email_id: sent.id, approved_by: approverUserId, approved_at: approverUserId ? new Date().toISOString() : null })
      .eq('id', draftId);

    return { id: sent.id, redirected: result.redirected };
  }

  // Efectos según el tipo de correo
  if (draft.kind === 'pendientes_y_visita' || draft.kind === 'recordatorio') {
    const now = new Date().toISOString();
    if (draft.kind === 'pendientes_y_visita') {
      await sb.from('pending_items').update({ status: 'pedido', requested_at: now }).eq('project_id', draft.project_id).eq('status', 'pendiente').eq('audience', 'cliente');
    } else {
      const { data: open } = await sb.from('pending_items').select('id,reminder_count').eq('project_id', draft.project_id).eq('status', 'pedido');
      for (const p of open ?? []) await sb.from('pending_items').update({ reminder_count: p.reminder_count + 1, last_reminder_at: now }).eq('id', p.id);
    }
    const { count } = await sb.from('pending_items').select('id', { count: 'exact', head: true }).eq('project_id', draft.project_id).eq('status', 'pedido');
    await sb
      .from('projects')
      .update({ status: count ? 'esperando_cliente' : 'listo_para_visita' })
      .eq('id', draft.project_id)
      .in('status', ['pendiente_revision', 'esperando_cliente']);
  }

  await audit(approverUserId ? 'correo_aprobado_y_enviado' : 'correo_interno_enviado', {
    projectId: draft.project_id,
    actorType: approverUserId ? 'usuario' : 'agente',
    actorId: approverUserId,
    payload: { draftId, tipo: draft.kind, canal: draft.channel ?? 'email', codigo: project?.code, redirigido: redirected },
  });
  return { emailId: sentEmailId, redirected };
}
