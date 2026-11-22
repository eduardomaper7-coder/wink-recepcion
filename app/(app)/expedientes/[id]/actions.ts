'use server';
/**
 * Acciones del arquitecto sobre el expediente. Todas comprueban la sesión y el rol, usan el
 * cliente de servicio para escribir y dejan rastro en la auditoría (quién aprueba qué).
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/core/audit';
import { sendDraft } from '@/agent/send';
import { loadBundle } from '@/agent/repo';
import { refreshPending } from '@/agent/analysis';
import { calendar } from '@/calendar/providers';
import { copyFile } from '@/storage/storage';
import { folderForDocType } from '@/storage/files';
import { env } from '@/config/env';
import { formatDateEs } from '@/lib/text';
import { saveDraft, visitConfirmationEmail } from '@/agent/drafts';
import { loadSettings } from '@/core/settings';
import { enqueue } from '@/queue/jobs';
import { runWorker } from '@/queue/worker';
import { after } from 'next/server';

type Result = { ok: true; message?: string } | { ok: false; error: string };
const done = (projectId: string, message?: string): Result => {
  revalidatePath(`/expedientes/${projectId}`);
  revalidatePath('/expedientes');
  return { ok: true, message };
};
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

const TEXT_FIELDS = ['briefing_md', 'scope_md', 'internal_context', 'title'] as const;

export async function updateProjectText(projectId: string, field: (typeof TEXT_FIELDS)[number], value: string): Promise<Result> {
  try {
    const u = await requireUser();
    if (!TEXT_FIELDS.includes(field)) throw new Error('Campo no editable');
    await supabaseAdmin().from('projects').update({ [field]: value }).eq('id', projectId);
    await audit('texto_editado', { projectId, actorType: 'usuario', actorId: u.id, payload: { campo: field } });
    return done(projectId, 'Guardado');
  } catch (e) {
    return fail(e);
  }
}

const ChecklistInput = z.array(z.object({ section: z.string(), items: z.array(z.object({ text: z.string(), reason: z.string().nullable(), origin: z.enum(['plantilla', 'agente', 'usuario']).optional(), done: z.boolean().optional() })) }));

export async function updateChecklist(projectId: string, sections: unknown): Promise<Result> {
  try {
    const u = await requireUser();
    const parsed = ChecklistInput.parse(sections);
    const { data: p } = await supabaseAdmin().from('projects').select('checklist').eq('id', projectId).single();
    await supabaseAdmin().from('projects').update({ checklist: { ...(p?.checklist ?? {}), sections: parsed } }).eq('id', projectId);
    await audit('checklist_editado', { projectId, actorType: 'usuario', actorId: u.id });
    return done(projectId, 'Checklist guardado');
  } catch (e) {
    return fail(e);
  }
}

export async function reclassifyDocument(docId: string, docType: string, subtype: string | null): Promise<Result> {
  try {
    const u = await requireUser();
    const sb = supabaseAdmin();
    const { data: doc } = await sb.from('documents').select('*, projects(code)').eq('id', docId).single();
    if (!doc) throw new Error('Documento no encontrado');
    const folder = folderForDocType(docType);
    const code = (doc.projects as { code: string }).code;
    const newName = (doc.new_name ?? doc.original_name).replace(new RegExp(`^${code}_[a-z_]+?_`), `${code}_${docType}_`);
    const newPath = `${code}/${folder}/${newName}`;
    if (newPath !== doc.storage_path && doc.status !== 'duplicado') await copyFile(doc.storage_path, newPath);
    await sb
      .from('documents')
      .update({
        doc_type: docType,
        folder,
        new_name: doc.status === 'duplicado' ? doc.new_name : newName,
        storage_path: doc.status === 'duplicado' ? doc.storage_path : newPath,
        classified_by: 'usuario',
        extracted: { ...(doc.extracted ?? {}), tipo: docType, subtipo: subtype },
      })
      .eq('id', docId);
    await refreshPending(await loadBundle(doc.project_id));
    await audit('documento_reclasificado', { projectId: doc.project_id, actorType: 'usuario', actorId: u.id, payload: { docId, de: doc.doc_type, a: docType } });
    return done(doc.project_id, 'Documento reclasificado y pendientes recalculados');
  } catch (e) {
    return fail(e);
  }
}

export async function setDocumentStatus(docId: string, status: 'ok' | 'ilegible' | 'duplicado'): Promise<Result> {
  try {
    const u = await requireUser();
    const sb = supabaseAdmin();
    const { data: doc } = await sb.from('documents').update({ status, classified_by: 'usuario' }).eq('id', docId).select('project_id').single();
    if (!doc) throw new Error('Documento no encontrado');
    await refreshPending(await loadBundle(doc.project_id));
    await audit('documento_estado', { projectId: doc.project_id, actorType: 'usuario', actorId: u.id, payload: { docId, status } });
    return done(doc.project_id);
  } catch (e) {
    return fail(e);
  }
}

export async function addPending(projectId: string, description: string, audience: 'cliente' | 'interno'): Promise<Result> {
  try {
    const u = await requireUser();
    if (!description.trim()) throw new Error('Escribe una descripción');
    await supabaseAdmin().from('pending_items').insert({ project_id: projectId, description: description.trim(), source: 'manual', audience, sort: 999 });
    await audit('pendiente_anadido', { projectId, actorType: 'usuario', actorId: u.id });
    return done(projectId);
  } catch (e) {
    return fail(e);
  }
}

export async function setPendingStatus(itemId: string, status: 'pendiente' | 'pedido' | 'recibido' | 'descartado'): Promise<Result> {
  try {
    const u = await requireUser();
    const { data } = await supabaseAdmin()
      .from('pending_items')
      .update({ status, ...(status === 'recibido' ? { received_at: new Date().toISOString() } : {}) })
      .eq('id', itemId)
      .select('project_id')
      .single();
    if (!data) throw new Error('No encontrado');
    await audit('pendiente_estado', { projectId: data.project_id, actorType: 'usuario', actorId: u.id, payload: { itemId, status } });
    return done(data.project_id);
  } catch (e) {
    return fail(e);
  }
}

export async function setResponsible(projectId: string, staffId: string | null): Promise<Result> {
  try {
    const u = await requireUser();
    await supabaseAdmin().from('projects').update({ responsible_staff_id: staffId }).eq('id', projectId);
    // El correo al cliente lleva en copia al responsable: se actualiza el borrador abierto
    if (staffId) {
      const { data: s } = await supabaseAdmin().from('staff').select('email').eq('id', staffId).single();
      if (s) await supabaseAdmin().from('email_drafts').update({ cc_emails: [s.email] }).eq('project_id', projectId).eq('status', 'borrador').in('kind', ['pendientes_y_visita', 'recordatorio', 'confirmacion_visita']);
    }
    await audit('responsable_cambiado', { projectId, actorType: 'usuario', actorId: u.id, payload: { staffId } });
    return done(projectId, 'Responsable actualizado');
  } catch (e) {
    return fail(e);
  }
}

const DraftEdit = z.object({ subject: z.string().min(1), body: z.string().min(1), to: z.array(z.string().email()), cc: z.array(z.string().email()) });

export async function updateDraft(draftId: string, input: unknown): Promise<Result> {
  try {
    const u = await requireUser();
    const d = DraftEdit.parse(input);
    const { data: cur } = await supabaseAdmin().from('email_drafts').select('channel').eq('id', draftId).single();
    if (cur?.channel !== 'whatsapp' && !d.to.length) throw new Error('Falta el destinatario');
    const { data } = await supabaseAdmin()
      .from('email_drafts')
      .update({ subject: d.subject, body_text: d.body, to_emails: d.to, cc_emails: d.cc })
      .eq('id', draftId)
      .eq('status', 'borrador')
      .select('project_id')
      .single();
    if (!data) throw new Error('El borrador ya no es editable');
    await audit('borrador_editado', { projectId: data.project_id, actorType: 'usuario', actorId: u.id, payload: { draftId } });
    return done(data.project_id, 'Borrador guardado');
  } catch (e) {
    return fail(e);
  }
}

export async function discardDraft(draftId: string): Promise<Result> {
  try {
    const u = await requireUser();
    const { data } = await supabaseAdmin().from('email_drafts').update({ status: 'descartado' }).eq('id', draftId).select('project_id').single();
    if (!data) throw new Error('No encontrado');
    await audit('borrador_descartado', { projectId: data.project_id, actorType: 'usuario', actorId: u.id, payload: { draftId } });
    return done(data.project_id);
  } catch (e) {
    return fail(e);
  }
}

export async function approveProject(projectId: string): Promise<Result> {
  try {
    const u = await requireUser();
    const sb = supabaseAdmin();
    await sb.from('projects').update({ approved_by: u.id, approved_at: new Date().toISOString() }).eq('id', projectId);
    const { count } = await sb.from('pending_items').select('id', { count: 'exact', head: true }).eq('project_id', projectId).in('status', ['pendiente', 'pedido']).eq('audience', 'cliente');
    if (!count) await sb.from('projects').update({ status: 'listo_para_visita' }).eq('id', projectId).eq('status', 'pendiente_revision');
    await audit('expediente_aprobado', { projectId, actorType: 'usuario', actorId: u.id });
    return done(projectId, 'Expediente aprobado');
  } catch (e) {
    return fail(e);
  }
}

/** "Aprobar y enviar correo al cliente": aprueba el expediente y envía el borrador dentro del hilo. */
export async function approveAndSend(projectId: string, draftId: string): Promise<Result> {
  try {
    const u = await requireUser();
    const sb = supabaseAdmin();
    const { data: draft } = await sb.from('email_drafts').select('compliance_flags,project_id').eq('id', draftId).single();
    if (draft?.project_id !== projectId) throw new Error('El borrador no pertenece a este expediente');
    await sb.from('projects').update({ approved_by: u.id, approved_at: new Date().toISOString() }).eq('id', projectId).is('approved_by', null);
    await audit('expediente_aprobado', { projectId, actorType: 'usuario', actorId: u.id });
    const r = await sendDraft(draftId, u.id);
    return done(projectId, r.redirected ? 'Enviado (modo demo: redirigido a la dirección de pruebas)' : 'Correo enviado al cliente');
  } catch (e) {
    return fail(e);
  }
}

export async function sendOtherDraft(draftId: string): Promise<Result> {
  try {
    const u = await requireUser();
    const { data } = await supabaseAdmin().from('email_drafts').select('project_id').eq('id', draftId).single();
    if (!data) throw new Error('No encontrado');
    const r = await sendDraft(draftId, u.id);
    return done(data.project_id, r.redirected ? 'Enviado (redirigido en modo demo)' : 'Enviado');
  } catch (e) {
    return fail(e);
  }
}

/** "Agendar visita": registra un hueco (propuesto o manual) en la agenda y en el expediente. */
export async function scheduleVisit(projectId: string, input: { slotId?: string; startIso?: string }): Promise<Result> {
  try {
    const u = await requireUser();
    const sb = supabaseAdmin();
    const settings = await loadSettings();
    let start: Date;
    let slotId = input.slotId ?? null;
    if (slotId) {
      const { data: slot } = await sb.from('visit_slots').select('starts_at').eq('id', slotId).single();
      if (!slot) throw new Error('Hueco no encontrado');
      start = new Date(slot.starts_at);
    } else if (input.startIso) {
      start = new Date(input.startIso);
      if (Number.isNaN(start.getTime())) throw new Error('Fecha no válida');
    } else throw new Error('Elige un hueco o una fecha');
    const end = new Date(start.getTime() + settings.visit_duration_min * 60_000);
    const b = await loadBundle(projectId);
    const ev = await calendar().createEvent({
      title: `Visita ${b.project.code} · ${b.client?.full_name ?? 'cliente'}`,
      description: `Visita al inmueble del expediente ${b.project.code}.\n${env().APP_BASE_URL}/expedientes/${projectId}`,
      start,
      end,
      location: b.property?.address ?? null,
      attendees: b.responsible ? [b.responsible.email] : [],
    });
    if (!slotId) {
      const { data: s } = await sb.from('visit_slots').insert({ project_id: projectId, starts_at: start.toISOString(), ends_at: end.toISOString(), status: 'confirmado', calendar_event_id: ev.eventId }).select('id').single();
      slotId = s?.id ?? null;
    } else {
      await sb.from('visit_slots').update({ status: 'confirmado', calendar_event_id: ev.eventId }).eq('id', slotId);
    }
    await sb.from('visit_slots').update({ status: 'descartado' }).eq('project_id', projectId).eq('status', 'propuesto');
    await sb.from('projects').update({ visit_at: start.toISOString(), visit_event_id: ev.eventId, status: 'visita_agendada' }).eq('id', projectId);
    if (b.client?.email) {
      const conf = visitConfirmationEmail({ clientName: b.client.full_name, when: start, address: b.property?.address ?? null, signature: settings.wink_signature });
      await saveDraft({ projectId, kind: 'confirmacion_visita', to: [b.client.email], cc: b.responsible ? [b.responsible.email] : [], subject: 'Confirmación de visita', body: conf.body, requiresApproval: true });
    }
    await audit('visita_agendada', { projectId, actorType: 'usuario', actorId: u.id, payload: { inicio: start.toISOString(), eventId: ev.eventId } });
    return done(projectId, `Visita agendada: ${formatDateEs(start)}`);
  } catch (e) {
    return fail(e);
  }
}

export async function resolveInconsistency(id: string): Promise<Result> {
  try {
    const u = await requireUser();
    const { data } = await supabaseAdmin().from('inconsistencies').update({ resolved_by: u.id, resolved_at: new Date().toISOString() }).eq('id', id).select('project_id').single();
    if (!data) throw new Error('No encontrado');
    await audit('incoherencia_resuelta', { projectId: data.project_id, actorType: 'usuario', actorId: u.id });
    return done(data.project_id);
  } catch (e) {
    return fail(e);
  }
}

export async function updateClient(projectId: string, input: { full_name: string; email: string; phone: string }): Promise<Result> {
  try {
    const u = await requireUser();
    const { data: p } = await supabaseAdmin().from('projects').select('client_id').eq('id', projectId).single();
    if (!p?.client_id) throw new Error('Sin cliente');
    const email = input.email.trim().toLowerCase() || null;
    if (email && !z.string().email().safeParse(email).success) throw new Error('Email no válido');
    const { error } = await supabaseAdmin().from('clients').update({ full_name: input.full_name.trim() || null, email, phone: input.phone.trim() || null }).eq('id', p.client_id);
    if (error) throw new Error(error.code === '23505' ? 'Ese email ya pertenece a otro cliente' : error.message);
    if (email) await supabaseAdmin().from('email_drafts').update({ to_emails: [email] }).eq('project_id', projectId).eq('status', 'borrador').in('kind', ['pendientes_y_visita', 'recordatorio', 'confirmacion_visita']);
    await audit('cliente_editado', { projectId, actorType: 'usuario', actorId: u.id });
    return done(projectId, 'Datos del cliente guardados');
  } catch (e) {
    return fail(e);
  }
}

export async function archiveProject(projectId: string): Promise<Result> {
  try {
    const u = await requireUser();
    await supabaseAdmin().from('projects').update({ status: 'archivado' }).eq('id', projectId);
    await audit('expediente_archivado', { projectId, actorType: 'usuario', actorId: u.id });
    return done(projectId, 'Archivado');
  } catch (e) {
    return fail(e);
  }
}

/** Reprocesar un correo (bandeja de revisión): vuelve a la cola desde cero. */
export async function reprocessEmail(emailId: string): Promise<Result> {
  try {
    const u = await requireUser();
    const sb = supabaseAdmin();
    await sb.from('emails').update({ processing_status: 'recibido', processing_error: null, classification: 'sin_clasificar' }).eq('id', emailId);
    await sb.from('agent_steps').delete().eq('email_id', emailId).neq('status', 'ok');
    await sb.from('jobs').delete().eq('dedupe_key', `email:${emailId}`);
    await enqueue('process_email', { emailId }, `email:${emailId}`);
    after(() => runWorker({ budgetMs: 280_000 }));
    await audit('correo_reprocesado', { actorType: 'usuario', actorId: u.id, payload: { emailId } });
    revalidatePath('/bandeja');
    return { ok: true, message: 'En cola' };
  } catch (e) {
    return fail(e);
  }
}

/** Marcar como revisado un correo que no es encargo. */
export async function dismissEmail(emailId: string): Promise<Result> {
  try {
    const u = await requireUser();
    await supabaseAdmin().from('emails').update({ approved_by: u.id }).eq('id', emailId);
    await audit('correo_revisado', { actorType: 'usuario', actorId: u.id, payload: { emailId } });
    revalidatePath('/bandeja');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Modo de respuesta por WhatsApp de este expediente (null = el de Ajustes). */
export async function setWaMode(projectId: string, mode: 'solo_recibir' | 'borrador' | 'asistente' | 'solo_equipo' | null): Promise<Result> {
  try {
    const u = await requireUser();
    if (mode !== null && !['solo_recibir', 'borrador', 'asistente', 'solo_equipo'].includes(mode)) throw new Error('Modo no válido');
    await supabaseAdmin().from('projects').update({ wa_reply_mode: mode }).eq('id', projectId);
    await audit('modo_whatsapp_cambiado', { projectId, actorType: 'usuario', actorId: u.id, payload: { modo: mode } });
    return done(projectId, 'Modo de respuesta por WhatsApp actualizado');
  } catch (e) {
    return fail(e);
  }
}

/** Cambia el canal de un borrador al cliente (correo ↔ WhatsApp). */
export async function setDraftChannel(draftId: string, channel: 'email' | 'whatsapp'): Promise<Result> {
  try {
    const u = await requireUser();
    const sb = supabaseAdmin();
    const { data: d } = await sb.from('email_drafts').select('project_id,status').eq('id', draftId).single();
    if (!d || d.status !== 'borrador') throw new Error('El borrador ya no es editable');
    const { data: p } = await sb.from('projects').select('wa_conversation_id, clients(email), responsible:responsible_staff_id(email)').eq('id', d.project_id).single();
    const clientEmail = (p?.clients as unknown as { email: string | null } | null)?.email ?? null;
    const respEmail = (p?.responsible as unknown as { email: string } | null)?.email ?? null;
    if (channel === 'whatsapp' && !p?.wa_conversation_id) throw new Error('Este expediente no tiene conversación de WhatsApp');
    if (channel === 'email' && !clientEmail) throw new Error('El cliente no tiene email: complétalo en la ficha del cliente');
    await sb
      .from('email_drafts')
      .update(
        channel === 'whatsapp'
          ? { channel, wa_conversation_id: p!.wa_conversation_id, to_emails: [], cc_emails: [] }
          : { channel, to_emails: [clientEmail], cc_emails: respEmail ? [respEmail] : [] },
      )
      .eq('id', draftId);
    await audit('borrador_canal', { projectId: d.project_id, actorType: 'usuario', actorId: u.id, payload: { draftId, channel } });
    return done(d.project_id, channel === 'whatsapp' ? 'Se enviará por WhatsApp' : 'Se enviará por correo');
  } catch (e) {
    return fail(e);
  }
}
