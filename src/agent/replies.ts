/**
 * Respuestas dentro del hilo de un expediente:
 *  - nuevos documentos o datos → se añaden, se reclasifica y se actualizan los pendientes;
 *  - confirmación de visita → se registra en la agenda y en el expediente;
 *  - el personal aporta el contacto que faltaba → se completa el expediente y se prepara el correo al cliente;
 *  - siempre: aviso al arquitecto y a la persona responsable.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runStep, skipRemainingSteps } from './steps';
import type { EmailAnalysis } from './schemas';
import { isInternalAddress, type identifySender } from './intake';
import type { StaffMember } from '@/core/settings';
import { classifyEmailAttachments, describeSummary } from './documents';
import { loadBundle, syncEntitiesFromFacts } from './repo';
import { refreshPending, runAnalysis, mustAskStaffFirst, isTechnicalUpdate, refreshTechnical } from './analysis';
import { internalUpdateNotice, saveDraft, visitConfirmationEmail } from './drafts';
import { sendDraft } from './send';
import { calendar } from '@/calendar/providers';
import { loadSettings } from '@/core/settings';
import { env } from '@/config/env';
import { audit } from '@/core/audit';
import { clientSafe, normalizeEmail, normalizePhone, parseSpanishNumber } from '@/lib/text';
import { log } from '@/lib/log';

export async function handleReply(o: {
  emailId: string;
  projectId: string;
  threadId: string | null;
  analysis: EmailAnalysis;
  identity: ReturnType<typeof identifySender>;
  staff: StaffMember[];
  channel?: 'email' | 'whatsapp';
  body?: string;
  waConversationId?: string | null;
  receivedAt?: string | null;
}) {
  const sb = supabaseAdmin();
  const settings = await loadSettings();
  const news: string[] = [];

  const link = await runStep(
    o.emailId,
    'r1_vinculo',
    async () => {
      await sb.from('emails').update({ project_id: o.projectId, thread_id: o.threadId }).eq('id', o.emailId);
      const b = await loadBundle(o.projectId);
      // Datos nuevos que aporta el correo (p. ej. el teléfono o el email que faltaba)
      const facts = o.analysis.datos
        .filter((d) => d.valor.trim())
        .map((d) => ({
          project_id: o.projectId,
          field: d.campo,
          value: d.valor.trim(),
          value_num: d.campo.endsWith('_m2') || d.campo.endsWith('year') ? parseSpanishNumber(d.valor) : null,
          source_type: 'email' as const,
          source_id: o.emailId,
          source_label: o.identity.senderType === 'personal' ? `Respuesta de ${o.identity.staff?.full_name ?? 'Wink'}` : 'Respuesta del cliente',
          is_internal: d.origen === 'personal',
          confidence: 0.9,
        }));
      if (facts.length) await sb.from('facts').insert(facts);

      // Contacto del cliente aportado por el personal
      if (b.client) {
        const email = normalizeEmail(o.analysis.cliente.email);
        const phone = normalizePhone(o.analysis.cliente.telefono) ?? o.analysis.cliente.telefono;
        const upd: Record<string, string> = {};
        const internal = !!email && isInternalAddress(email, settings.internal_domains, o.staff, settings.agent_mailbox);
        if (!b.client.email && email && !internal && o.identity.senderType === 'personal') upd.email = email;
        if (!b.client.phone && phone) upd.phone = phone;
        if (!b.client.full_name && o.analysis.cliente.nombre) upd.full_name = o.analysis.cliente.nombre;
        if (Object.keys(upd).length) {
          await sb.from('clients').update(upd).eq('id', b.client.id);
          news.push(`Datos de contacto del cliente actualizados (${Object.keys(upd).join(', ')})`);
          await sb.from('pending_items').update({ status: 'recibido', received_at: new Date().toISOString() }).eq('project_id', o.projectId).eq('audience', 'interno').in('status', ['pendiente', 'pedido']);
        }
      }
      if (facts.length) news.push(`${facts.length} dato(s) nuevo(s) en el ${o.channel === 'whatsapp' ? 'WhatsApp' : 'correo'}`);

      // WhatsApp del personal (p. ej. durante la visita): el texto queda como nota interna del expediente
      if (o.channel === 'whatsapp' && o.identity.senderType === 'personal' && o.body?.trim()) {
        const when = new Date(o.receivedAt ?? Date.now()).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });
        const note = `[${when} · ${o.identity.staff?.full_name ?? 'Personal'} por WhatsApp] ${o.body.trim()}`;
        const { data: cur } = await sb.from('projects').select('internal_context').eq('id', o.projectId).single();
        await sb.from('projects').update({ internal_context: [cur?.internal_context, note].filter(Boolean).join('\n\n') }).eq('id', o.projectId);
        news.push(`Nota de ${o.identity.staff?.full_name ?? 'personal'} por WhatsApp añadida a las notas internas`);
      }
      // El cliente escribe por WhatsApp: el expediente queda enlazado a su conversación
      if (o.channel === 'whatsapp' && o.identity.senderType === 'cliente' && o.waConversationId && !b.project.wa_conversation_id) {
        await sb.from('projects').update({ wa_conversation_id: o.waConversationId }).eq('id', o.projectId);
      }
      return { output: { code: b.project.code, status: b.project.status }, detail: `${b.project.code} · ${o.identity.senderType === 'cliente' ? 'respuesta del cliente' : 'respuesta del personal'}` };
    },
    o.projectId,
  );

  const docs = await runStep(
    o.emailId,
    'r2_documentos',
    async () => {
      const s = await classifyEmailAttachments({ projectId: o.projectId, projectCode: link.code, emailId: o.emailId, context: 'documentación adicional enviada para un expediente de reforma' });
      return { output: s, detail: describeSummary(s), model: s.model ?? undefined, usage: s.usage };
    },
    o.projectId,
  );
  if (docs.total) news.push(`Documentación nueva: ${describeSummary(docs)}`);

  let bundle = await loadBundle(o.projectId);
  await syncEntitiesFromFacts(bundle);
  bundle = await loadBundle(o.projectId);

  // ¿Estaba esperando los datos de contacto internos y ya los tenemos? → completar el expediente
  if (bundle.project.status === 'esperando_datos_internos' && !mustAskStaffFirst(bundle)) {
    await skipRemainingSteps(o.emailId, 'Se completa el expediente con los datos recibidos');
    await runAnalysis(o.projectId, { emailId: o.emailId, replyToEmailId: null, originalSubject: null });
    news.push('Contacto del cliente completado: expediente y correo al cliente listos para revisión');
    await notify(o.projectId, link.code, bundle.client?.full_name ?? null, news, o.emailId, settings.auto_send_internal);
    return;
  }

  await runStep(
    o.emailId,
    'r4_pendientes',
    async () => {
      const before = (await sb.from('pending_items').select('id').eq('project_id', o.projectId).in('status', ['pendiente', 'pedido'])).data?.length ?? 0;
      await refreshPending(bundle);
      const { data: open } = await sb.from('pending_items').select('id,description,status').eq('project_id', o.projectId).eq('audience', 'cliente').in('status', ['pendiente', 'pedido']);
      const after = open?.length ?? 0;
      const received = Math.max(0, before - after);
      if (received) news.push(`${received} pendiente(s) marcado(s) como recibido(s)`);
      if (after === 0 && bundle.project.status === 'esperando_cliente') {
        await sb.from('projects').update({ status: 'listo_para_visita' }).eq('id', o.projectId);
        news.push('Toda la documentación obligatoria recibida: expediente listo para la visita');
      }
      return { output: { recibidos: received, abiertos: after }, detail: `${received} recibido(s) · ${after} abierto(s)` };
    },
    o.projectId,
  );

  // El personal aporta información técnica (p. ej. desde la visita): se rehacen briefing y alcance.
  await runStep<Record<string, unknown>>(
    o.emailId,
    'r5_tecnico',
    async () => {
      if (o.identity.senderType !== 'personal') return { output: { accion: 'ninguna' }, detail: 'Sin cambios técnicos' };
      let text = o.body ?? '';
      if (!text) {
        const { data: em } = await sb.from('emails').select('body_text').eq('id', o.emailId).single();
        text = em?.body_text ?? '';
      }
      if (!isTechnicalUpdate(text, docs.total)) return { output: { accion: 'ninguna' }, detail: 'Mensaje sin información técnica: solo nota interna' };
      const author = o.identity.staff?.full_name ?? 'personal de Wink';
      const r = await refreshTechnical(o.projectId, o.emailId, { author, channel: o.channel ?? 'email', when: new Date(o.receivedAt ?? Date.now()), text, newDocs: docs.total });
      const parts: string[] = [];
      if (r.briefing === 'actualizado') parts.push(`briefing actualizado (dudas abiertas: ${r.dudas[0]} → ${r.dudas[1]})`);
      else parts.push('briefing NO regenerado porque estaba editado a mano: revisar las notas nuevas');
      if (r.alcance === 'actualizado') {
        parts.push('alcance actualizado');
        const list = (xs: string[]) => (xs.length > 4 ? `${xs.slice(0, 4).join('; ')} y ${xs.length - 4} más` : xs.join('; '));
        if (r.partidasNuevas.length) parts.push(`partidas nuevas: ${list(r.partidasNuevas)}`);
        if (r.partidasQuitadas.length) parts.push(`partidas que salen: ${list(r.partidasQuitadas)}`);
      } else parts.push('alcance NO regenerado porque estaba editado a mano');
      news.push(`Información de ${author}: ${parts.join(' · ')}`);
      return { output: r as unknown as Record<string, unknown>, detail: parts.join(' · ') };
    },
    o.projectId,
  );

  await runStep<Record<string, unknown>>(
    o.emailId,
    'r6_visita',
    async () => {
      const c = o.analysis.confirmacion_visita;
      if (!c || (!c.confirma && !c.propuesta_alternativa)) return { output: { accion: 'ninguna' }, detail: 'Sin cambios en la visita' };
      const { data: slots } = await sb.from('visit_slots').select('*').eq('project_id', o.projectId).eq('status', 'propuesto').order('starts_at');
      const chosen = c.confirma && c.hueco_elegido && slots?.[c.hueco_elegido - 1] ? slots[c.hueco_elegido - 1] : c.confirma && slots?.length === 1 ? slots[0] : null;
      if (!chosen) {
        news.push(`El cliente propone otra fecha para la visita: «${c.propuesta_alternativa ?? 'sin concretar'}». Requiere gestión manual.`);
        return { output: { accion: 'alternativa', texto: c.propuesta_alternativa }, detail: 'El cliente propone otra fecha: revisar' };
      }
      const start = new Date(chosen.starts_at);
      const end = new Date(chosen.ends_at);
      let eventId: string | null = null;
      try {
        const ev = await calendar().createEvent({
          title: `Visita ${bundle.project.code} · ${bundle.client?.full_name ?? 'cliente'}`,
          description: `Visita al inmueble del expediente ${bundle.project.code}.\n${env().APP_BASE_URL}/expedientes/${o.projectId}`,
          start,
          end,
          location: bundle.property?.address ?? null,
          attendees: bundle.responsible ? [bundle.responsible.email] : [],
        });
        eventId = ev.eventId;
      } catch (e) {
        log.error('No se pudo crear el evento de visita', { error: String(e) });
        news.push('⚠ No se pudo registrar la visita en la agenda: crear el evento manualmente');
      }
      await sb.from('visit_slots').update({ status: 'confirmado', calendar_event_id: eventId }).eq('id', chosen.id);
      await sb.from('visit_slots').update({ status: 'descartado' }).eq('project_id', o.projectId).eq('status', 'propuesto');
      await sb.from('projects').update({ visit_at: chosen.starts_at, visit_event_id: eventId, status: 'visita_agendada' }).eq('id', o.projectId);
      const conf = visitConfirmationEmail({ clientName: bundle.client?.full_name ?? null, when: start, address: bundle.property?.address ?? null, signature: settings.wink_signature });
      if (bundle.client?.email) {
        await saveDraft({
          projectId: o.projectId,
          kind: 'confirmacion_visita',
          to: [bundle.client.email],
          cc: bundle.responsible ? [bundle.responsible.email] : [],
          subject: 'Confirmación de visita',
          body: conf.body,
          inReplyToEmailId: o.emailId,
          requiresApproval: true,
        });
      }
      await audit('visita_confirmada', { projectId: o.projectId, payload: { inicio: chosen.starts_at, eventId } });
      news.push(`Visita confirmada por el cliente: ${start.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} (registrada en la agenda)`);
      return { output: { accion: 'confirmada', inicio: chosen.starts_at, eventId }, detail: `Visita confirmada y registrada en la agenda` };
    },
    o.projectId,
  );

  // Modo «Borrador con aprobación» en WhatsApp: se prepara la respuesta para el cliente
  if (o.channel === 'whatsapp' && o.identity.senderType === 'cliente' && o.waConversationId) {
    const mode = (bundle.project.wa_reply_mode as string | null) ?? settings.wa_reply_modes.cliente_con_expediente;
    if (mode === 'borrador') {
      const { data: open } = await sb.from('pending_items').select('description').eq('project_id', o.projectId).eq('audience', 'cliente').in('status', ['pendiente', 'pedido']).order('sort');
      const first = bundle.client?.full_name?.split(' ')[0];
      const lines = [
        `Gracias${first ? `, ${first}` : ''}. ${docs.total ? 'Hemos recibido la documentación que nos ha enviado.' : 'Hemos recibido su mensaje.'}`,
        ...(open?.length ? ['', 'Para avanzar todavía necesitamos:', ...open.map((p) => `• ${clientSafe(p.description)}`)] : ['', 'Con esto tenemos todo lo necesario por ahora.']),
        '',
        'Un arquitecto del equipo lo revisa y le escribimos en breve.',
        '— Equipo Wink',
      ];
      await saveDraft({
        projectId: o.projectId,
        kind: 'respuesta',
        to: [],
        cc: [],
        subject: 'Respuesta por WhatsApp',
        body: lines.join('\n'),
        requiresApproval: true,
        channel: 'whatsapp',
        waConversationId: o.waConversationId,
      });
      news.push('Respuesta por WhatsApp preparada para aprobar');
    }
  }

  await notify(o.projectId, link.code, bundle.client?.full_name ?? null, news, o.emailId, settings.auto_send_internal);
}

async function notify(projectId: string, code: string, clientName: string | null, news: string[], emailId: string, autoSend: boolean) {
  await runStep(
    emailId,
    'r7_aviso',
    async () => {
      const sb = supabaseAdmin();
      const lines = news.length ? news : ['El cliente ha respondido (sin documentación ni datos nuevos)'];
      const b = await loadBundle(projectId);
      // Arquitecto que aprobó el expediente (si lo hay) + responsable
      const recipients = new Set<string>();
      if (b.responsible) recipients.add(b.responsible.email);
      const { data: approver } = await sb.from('projects').select('approved_by').eq('id', projectId).single();
      if (approver?.approved_by) {
        const { data: prof } = await sb.from('profiles').select('staff:staff_id(email)').eq('user_id', approver.approved_by).maybeSingle();
        const email = (prof?.staff as unknown as { email: string } | null)?.email;
        if (email) recipients.add(email);
      }
      await audit('aviso_novedades', { projectId, payload: { novedades: lines.length } });
      if (!recipients.size) return { output: { enviados: 0 }, detail: 'Sin responsable asignado: aviso visible solo en la aplicación' };
      const n = internalUpdateNotice({ projectCode: code, clientName, lines, appUrl: env().APP_BASE_URL, projectId });
      const draftId = await saveDraft({ projectId, kind: 'aviso_interno', to: [...recipients], cc: [], subject: n.subject, body: n.body, requiresApproval: !autoSend });
      if (autoSend) await sendDraft(draftId, null);
      return { output: { enviados: recipients.size }, detail: `Aviso ${autoSend ? 'enviado' : 'preparado'} a ${recipients.size} persona(s)` };
    },
    projectId,
  );
}
