/**
 * Tareas 3 a 6 sobre un expediente: briefing, pendientes (+ correo), alcance, checklist y visita.
 * Las tareas independientes se ejecutan en paralelo para cumplir el objetivo de < 1 minuto.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { llm } from './llm';
import { runStep } from './steps';
import { loadBundle, syncEntitiesFromFacts, type ProjectBundle } from './repo';
import { detectInconsistencies, bestValue } from './facts';
import { computePending, itemsToRequest, type RequiredTemplate } from './pending';
import { buildBaseChecklist, mergeAgentItems, type ChecklistTemplate } from './checklist';
import { BriefingSchema, ScopeSchema, ChecklistExtraSchema, type Briefing, type Scope } from './schemas';
import { SYSTEM_BRIEFING, SYSTEM_SCOPE, SYSTEM_CHECKLIST } from './prompts';
import { briefingToMarkdown, scopeToMarkdown } from './render';
import { asksPriceOrTime, composeClientEmail, internalContactRequest, saveDraft } from './drafts';
import { sendDraft } from './send';
import { parseAvailability, proposeSlots } from '@/calendar/slots';
import { calendar } from '@/calendar/providers';
import { loadSettings, type AppSettings } from '@/core/settings';
import { FIELD_LABELS, type FactField } from './fields';
import { env } from '@/config/env';
import { audit } from '@/core/audit';
import { parseSpanishNumber } from '@/lib/text';
import { log } from '@/lib/log';

/** Contexto textual del expediente para los modelos. Separa lo que dice el cliente de las notas internas. */
function dossier(b: ProjectBundle, opts: { includeInternal: boolean }): string {
  const factLines = b.facts
    .filter((f) => opts.includeInternal || !f.is_internal)
    .map((f) => `- ${FIELD_LABELS[f.field as FactField] ?? f.field}: ${f.value} [fuente: ${f.source_label ?? f.source_type}${f.is_internal ? ', nota interna del personal' : ''}]`);
  const docLines = b.docs.map(
    (d) =>
      `- ${d.new_name ?? d.original_name} · tipo ${d.doc_type} · estado ${d.status}${d.description ? ` · ${d.description}` : ''}${
        d.extracted && (d.extracted as Record<string, unknown>).foto ? ` · foto: ${JSON.stringify((d.extracted as Record<string, unknown>).foto)}` : ''
      }${d.extracted && (d.extracted as Record<string, unknown>).plano ? ` · plano: ${JSON.stringify((d.extracted as Record<string, unknown>).plano)}` : ''}`,
  );
  return [
    `Expediente ${b.project.code}. Origen: ${b.project.origin.replace('_', ' ')}.`,
    '',
    'DATOS CONOCIDOS (con su fuente):',
    ...(factLines.length ? factLines : ['- (ninguno)']),
    '',
    'DOCUMENTOS RECIBIDOS:',
    ...(docLines.length ? docLines : ['- (ninguno)']),
    ...(opts.includeInternal && b.project.internal_context ? ['', 'NOTAS INTERNAS DEL PERSONAL DE WINK (contexto interno, no para el cliente):', b.project.internal_context] : []),
  ].join('\n');
}

async function refreshInconsistencies(b: ProjectBundle) {
  const sb = supabaseAdmin();
  const found = detectInconsistencies(b.facts);
  await sb.from('inconsistencies').delete().eq('project_id', b.project.id).eq('origin', 'agente').is('resolved_at', null);
  if (found.length) {
    await sb.from('inconsistencies').insert(found.map((f) => ({ project_id: b.project.id, field: f.field, description: f.description, fact_ids: f.factIds, origin: 'agente' })));
  }
  return found;
}

/** Recalcula pendientes conservando los añadidos a mano y marcando los recibidos. */
export async function refreshPending(b: ProjectBundle) {
  const sb = supabaseAdmin();
  const { data: tpl } = await sb.from('required_docs_templates').select('*').eq('active', true).eq('project_type_id', b.project.project_type_id);
  const results = computePending((tpl ?? []) as RequiredTemplate[], b.docs, b.facts.map((f) => ({ field: f.field, value: f.value })));
  const { data: existing } = await sb.from('pending_items').select('id,template_id,status').eq('project_id', b.project.id).eq('source', 'auto');
  const byTemplate = new Map((existing ?? []).map((e) => [e.template_id, e]));
  const now = new Date().toISOString();
  for (const r of results) {
    const prev = byTemplate.get(r.templateId);
    if (r.satisfied) {
      if (prev && prev.status !== 'recibido' && prev.status !== 'descartado') {
        await sb.from('pending_items').update({ status: 'recibido', received_at: now, resolved_by_document_id: r.resolvedByDocumentId }).eq('id', prev.id);
      }
    } else if (!prev) {
      await sb.from('pending_items').insert({
        project_id: b.project.id,
        description: r.note ? `${r.description} — ${r.note}` : r.description,
        status: 'pendiente',
        source: 'auto',
        template_id: r.templateId,
        audience: r.audience,
        sort: r.sort,
      });
    } else if (prev.status === 'recibido') {
      // Volvió a faltar (p. ej. el arquitecto reclasificó el documento)
      await sb.from('pending_items').update({ status: 'pendiente', received_at: null }).eq('id', prev.id);
    }
  }
  return results;
}

function missingContact(b: ProjectBundle): string[] {
  const missing: string[] = [];
  if (!b.client?.email) missing.push('el email del cliente');
  if (!b.client?.phone && !bestValue(b.facts, 'client.phone') && b.project.origin === 'encargo_personal') missing.push('su teléfono');
  return missing;
}

/** ¿Hay que pedir antes los datos de contacto a la persona de Wink? */
export function mustAskStaffFirst(b: ProjectBundle): boolean {
  if (b.project.origin === 'cliente_directo' || b.project.origin === 'whatsapp') return false;
  return missingContact(b).length > 0;
}

export interface AnalysisOptions {
  emailId: string;
  /** correo del cliente al que responder en el hilo (si nos escribió directamente) */
  replyToEmailId: string | null;
  originalSubject: string | null;
}

export async function runAnalysis(projectId: string, opts: AnalysisOptions) {
  const sb = supabaseAdmin();
  const settings = await loadSettings();
  let b = await loadBundle(projectId);
  await syncEntitiesFromFacts(b);
  b = await loadBundle(projectId);
  const inconsistencies = await refreshInconsistencies(b);

  const tBriefing = runStep(
    opts.emailId,
    't3_briefing',
    async () => {
      const r = await llm().run({
        task: 'briefing',
        tier: 'smart',
        system: SYSTEM_BRIEFING,
        content: [
          {
            type: 'text',
            text: `${dossier(b, { includeInternal: true })}\n\nINCOHERENCIAS DETECTADAS AUTOMÁTICAMENTE (inclúyelas):\n${
              inconsistencies.map((i) => `- ${i.description}`).join('\n') || '- ninguna'
            }\n\nRedacta el briefing técnico.`,
          },
        ],
        toolName: 'guardar_briefing',
        toolDescription: 'Guarda el briefing técnico del expediente',
        schema: BriefingSchema,
        maxTokens: 4000,
      });
      const md = briefingToMarkdown(r.data);
      await sb.from('projects').update({ briefing: r.data, briefing_md: md, title: r.data.titulo }).eq('id', projectId);
      return {
        output: { titulo: r.data.titulo, incoherencias: r.data.incoherencias.length, dudas: r.data.dudas.length },
        detail: `${r.data.incoherencias.length} incoherencia(s), ${r.data.dudas.length} duda(s)`,
        model: r.model,
        usage: r.usage,
      };
    },
    projectId,
  );

  const tScope = runStep(
    opts.emailId,
    't5_alcance',
    async () => {
      const r = await llm().run({
        task: 'alcance',
        tier: 'smart',
        system: SYSTEM_SCOPE,
        content: [{ type: 'text', text: `${dossier(b, { includeInternal: true })}\n\nPropón el alcance técnico preliminar.` }],
        toolName: 'guardar_alcance',
        toolDescription: 'Guarda el alcance preliminar (borrador)',
        schema: ScopeSchema,
        maxTokens: 3000,
      });
      await sb.from('projects').update({ scope: { ...r.data, borrador: true }, scope_md: scopeToMarkdown(r.data) }).eq('id', projectId);
      return { output: { incluye: r.data.incluye.length, no_incluye: r.data.no_incluye.length }, detail: `${r.data.incluye.length} partidas incluidas, ${r.data.no_incluye.length} excluidas`, model: r.model, usage: r.usage };
    },
    projectId,
  );

  const tVisit = runStep(
    opts.emailId,
    't6_visita',
    async () => {
      const { data: tpl } = await sb.from('checklist_templates').select('*').eq('active', true);
      const year = parseSpanishNumber(bestValue(b.facts, 'property.building_year')?.value) ?? b.property?.building_year ?? null;
      const rooms = (bestValue(b.facts, 'request.rooms')?.value ?? '').split(/[,;]| y /).map((s) => s.trim()).filter(Boolean);
      const base = buildBaseChecklist((tpl ?? []) as ChecklistTemplate[], {
        buildingYear: year ? Math.round(year) : null,
        typology: bestValue(b.facts, 'property.typology')?.value ?? null,
        rooms,
      });
      const r = await llm().run({
        task: 'checklist',
        tier: 'fast',
        system: SYSTEM_CHECKLIST,
        content: [
          {
            type: 'text',
            text: `${dossier(b, { includeInternal: true })}\n\nCHECKLIST BASE YA INCLUIDO:\n${base.sections.map((s) => `${s.section}: ${s.items.map((i) => i.text).join(' | ')}`).join('\n')}`,
          },
        ],
        toolName: 'ampliar_checklist',
        toolDescription: 'Añade comprobaciones específicas del inmueble',
        schema: ChecklistExtraSchema,
        maxTokens: 1500,
      });
      const sections = mergeAgentItems(base.sections, r.data.extra);

      // Propuesta de huecos según la agenda
      let slots: { start: Date; end: Date }[] = [];
      // Si la visita ya está reservada (p. ej. por el asistente de WhatsApp) no se proponen huecos
      if (!b.project.visit_at) try {
        const now = new Date();
        const busy = await calendar().busy(now, new Date(now.getTime() + (settings.visit_hours.lookahead_days + 4) * 86_400_000));
        const pref = parseAvailability(bestValue(b.facts, 'client.availability')?.value);
        slots = proposeSlots(now, busy, settings.visit_hours, settings.visit_duration_min, pref);
        // Si la preferencia deja sin huecos, se proponen los normales (el cliente puede pedir otro)
        if (!slots.length && pref) slots = proposeSlots(now, busy, settings.visit_hours, settings.visit_duration_min);
      } catch (e) {
        log.warn('No se pudo consultar la agenda', { error: String(e) });
      }
      await sb.from('visit_slots').delete().eq('project_id', projectId).eq('status', 'propuesto');
      if (slots.length) {
        await sb.from('visit_slots').insert(slots.map((s) => ({ project_id: projectId, starts_at: s.start.toISOString(), ends_at: s.end.toISOString() })));
      }
      await sb.from('projects').update({ checklist: { sections, plantillas: base.applied } }).eq('id', projectId);
      const nItems = sections.reduce((n, s) => n + s.items.length, 0);
      return {
        output: { items: nItems, extra: r.data.extra.length, huecos: slots.map((s) => s.start.toISOString()) },
        detail: `${nItems} comprobaciones (${r.data.extra.length} específicas) · ${slots.length} huecos propuestos`,
        model: r.model,
        usage: r.usage,
      };
    },
    projectId,
  );

  // allSettled se engancha YA para que un fallo no quede como promesa rechazada sin capturar
  const settled = Promise.allSettled([tBriefing, tScope, tVisit]);
  // Pendientes (deterministas) en paralelo con lo anterior; el correo necesita los huecos de visita
  const pendingResults = await refreshPending(b);
  const results = await settled;
  const failed = results.filter((r) => r.status === 'rejected');

  await runStep<Record<string, unknown>>(
    opts.emailId,
    't4_pendientes',
    async () => {
      b = await loadBundle(projectId);
      const { required, optional } = itemsToRequest(pendingResults);

      if (mustAskStaffFirst(b)) {
        const missing = missingContact(b);
        for (const m of missing) {
          const { data: exists } = await sb.from('pending_items').select('id').eq('project_id', projectId).eq('audience', 'interno').eq('description', `Pedir a Wink: ${m}`).maybeSingle();
          if (!exists) await sb.from('pending_items').insert({ project_id: projectId, description: `Pedir a Wink: ${m}`, source: 'agente', audience: 'interno', status: 'pedido', requested_at: new Date().toISOString() });
        }
        const staff = b.responsible;
        if (staff) {
          const msg = internalContactRequest({ staffName: staff.full_name, projectCode: b.project.code, clientName: b.client?.full_name ?? null, missing, appUrl: env().APP_BASE_URL });
          const draftId = await saveDraft({
            projectId,
            kind: 'solicitud_interna',
            to: [staff.email],
            cc: [],
            subject: msg.subject,
            body: msg.body,
            inReplyToEmailId: opts.emailId,
            requiresApproval: !settings.auto_send_internal,
          });
          if (settings.auto_send_internal) await sendDraft(draftId, null);
        }
        await sb.from('projects').update({ status: 'esperando_datos_internos' }).eq('id', projectId);
        return {
          output: { requerido: required.length, opcional: optional.length, solicitud_interna: true },
          detail: `Faltan datos de contacto: se han pedido a ${staff?.full_name ?? 'la persona responsable'} antes de escribir al cliente`,
        };
      }

      const { data: slotRows } = await sb.from('visit_slots').select('starts_at,ends_at').eq('project_id', projectId).eq('status', 'propuesto').order('starts_at');
      const slots = (slotRows ?? []).map((s) => ({ start: new Date(s.starts_at), end: new Date(s.ends_at) }));
      const clientSaid = b.facts.filter((f) => !f.is_internal && f.field === 'request.needs').map((f) => f.value)[0] ?? null;
      const channel: 'email' | 'whatsapp' = b.project.wa_conversation_id && (b.project.origin === 'whatsapp' || !b.client?.email) ? 'whatsapp' : 'email';
      let clientAskedPriceOrTime = false;
      if (opts.replyToEmailId) {
        const { data: orig } = await sb.from('emails').select('body_text').eq('id', opts.replyToEmailId).maybeSingle();
        clientAskedPriceOrTime = asksPriceOrTime(orig?.body_text);
      }
      const composed = await composeClientEmail({
        clientAskedPriceOrTime,
        channel,
        visitAt: b.project.visit_at ? new Date(b.project.visit_at) : null,
        clientName: b.client?.full_name ?? null,
        clientRequestSummary: clientSaid,
        originalSubject: opts.originalSubject,
        required,
        optional,
        slots,
        internalNotes: b.project.internal_context,
        signature: settings.wink_signature,
        isFirstContactFromWink: !opts.replyToEmailId,
      });
      await saveDraft({
        projectId,
        kind: 'pendientes_y_visita',
        to: channel === 'whatsapp' ? [] : b.client?.email ? [b.client.email] : [],
        cc: channel === 'whatsapp' ? [] : b.responsible ? [b.responsible.email] : [],
        subject: composed.subject,
        body: composed.body,
        inReplyToEmailId: channel === 'whatsapp' ? null : opts.replyToEmailId,
        requiresApproval: true,
        channel,
        waConversationId: channel === 'whatsapp' ? b.project.wa_conversation_id : null,
        flags: composed.flags.map((f) => `${f.code}: ${f.match}`),
      });
      return {
        output: { requerido: required.length, opcional: optional.length, avisos: composed.flags.length },
        detail: `${required.length} pendiente(s) obligatorio(s), ${optional.length} opcional(es) · ${channel === 'whatsapp' ? 'WhatsApp' : 'correo'} al cliente listo para aprobar${composed.flags.length ? ' (con avisos)' : ''}`,
        model: composed.model,
        usage: composed.usage,
      };
    },
    projectId,
  );

  if (failed.length) throw (failed[0] as PromiseRejectedResult).reason;

  const { data: proj } = await sb.from('projects').select('status').eq('id', projectId).single();
  if (proj?.status === 'procesando') {
    await sb.from('projects').update({ status: 'pendiente_revision', ready_at: new Date().toISOString() }).eq('id', projectId);
  } else if (proj?.status === 'esperando_datos_internos' && !mustAskStaffFirst(await loadBundle(projectId))) {
    await sb.from('projects').update({ status: 'pendiente_revision', ready_at: new Date().toISOString() }).eq('id', projectId);
  }
  await audit('expediente_preparado', { projectId, payload: { estado: proj?.status } });
}

export type { AppSettings, Briefing };

// ─────────────────────────────────────────────────────────────────────────────
// Actualización técnica: el personal (p. ej. el jefe de obra desde la visita) aporta
// información nueva → se rehacen briefing y alcance. El correo al cliente NO se toca.
// ─────────────────────────────────────────────────────────────────────────────

export interface TechnicalUpdate {
  author: string; // "Javier Gómez (jefe de obra)"
  channel: 'whatsapp' | 'email';
  when: Date;
  text: string; // lo que ha escrito (vacío si solo manda fotos)
  newDocs: number;
}

/** ¿El mensaje del personal trae información técnica? Un "ok" o "llego en 10 min" no rehace nada. */
export function isTechnicalUpdate(text: string | null | undefined, newDocs: number): boolean {
  const t = (text ?? '').trim();
  if (newDocs > 0) return true;
  if (t.length < 60) return false;
  return t.split(/\s+/).length >= 10;
}

const updateHeader = (u: TechnicalUpdate) => {
  const when = u.when.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return `> **Actualizado** con la información de ${u.author} (${u.channel === 'whatsapp' ? 'WhatsApp' : 'correo'}, ${when}).`;
};

/** El texto guardado ya no coincide con lo generado: alguien lo ha editado a mano. */
const editedByHand = (md: string | null, generated: string) => !!md && !md.trimEnd().endsWith(generated.trimEnd());

export async function refreshTechnical(projectId: string, emailId: string, u: TechnicalUpdate) {
  const sb = supabaseAdmin();
  let b = await loadBundle(projectId);
  await syncEntitiesFromFacts(b);
  b = await loadBundle(projectId);
  const inconsistencies = await refreshInconsistencies(b);
  const { data: cur } = await sb.from('projects').select('briefing,briefing_md,scope,scope_md').eq('id', projectId).single();
  const prevBriefing = (cur?.briefing ?? null) as Briefing | null;
  const prevScope = (cur?.scope ?? null) as Scope | null;
  const briefingEdited = prevBriefing ? editedByHand(cur?.briefing_md ?? null, briefingToMarkdown(prevBriefing)) : false;
  const scopeEdited = prevScope ? editedByHand(cur?.scope_md ?? null, scopeToMarkdown(prevScope)) : false;

  const novedad = [
    `NOVEDAD — información aportada por ${u.author} (personal de Wink) por ${u.channel === 'whatsapp' ? 'WhatsApp' : 'correo'}${u.newDocs ? `, con ${u.newDocs} archivo(s) nuevo(s) ya incluidos en DOCUMENTOS` : ''}:`,
    u.text.trim() || '(solo archivos, sin texto)',
    '',
    `Es información MÁS RECIENTE que la anterior y viene de quien ha estado en la vivienda. Úsala para: resolver las dudas que contesta (quítalas de "dudas"), corregir o precisar supuestos anteriores, y añadir lo nuevo. Cita su fuente como «Visita – ${u.author}». Lo que diga como opinión técnica ("no parece de carga") se recoge como observación pendiente de confirmar por el arquitecto, no como hecho cerrado.`,
  ].join('\n');

  const result: { briefing: 'actualizado' | 'editado_a_mano'; alcance: 'actualizado' | 'editado_a_mano'; dudas: [number, number]; partidasNuevas: string[]; partidasQuitadas: string[] } = {
    briefing: briefingEdited ? 'editado_a_mano' : 'actualizado',
    alcance: scopeEdited ? 'editado_a_mano' : 'actualizado',
    dudas: [prevBriefing?.dudas.length ?? 0, prevBriefing?.dudas.length ?? 0],
    partidasNuevas: [],
    partidasQuitadas: [],
  };

  const tasks: Promise<unknown>[] = [];
  if (!briefingEdited) {
    tasks.push(
      llm()
        .run({
          task: 'briefing',
          tier: 'smart',
          system: SYSTEM_BRIEFING,
          content: [
            {
              type: 'text',
              text: `${dossier(b, { includeInternal: true })}\n\nINCOHERENCIAS DETECTADAS AUTOMÁTICAMENTE (inclúyelas):\n${inconsistencies.map((i) => `- ${i.description}`).join('\n') || '- ninguna'}\n\n${novedad}${
                prevBriefing ? `\n\nBRIEFING ANTERIOR (JSON). Parte de él y cambia SOLO lo que la novedad afecta: mantén el resto igual, elimina de "dudas" las que la novedad responde y añade solo las dudas nuevas que surjan:\n${JSON.stringify(prevBriefing)}` : ''
              }\n\nDevuelve el briefing técnico actualizado completo.`,
            },
          ],
          toolName: 'guardar_briefing',
          toolDescription: 'Guarda el briefing técnico actualizado del expediente',
          schema: BriefingSchema,
          maxTokens: 4000,
        })
        .then(async (r) => {
          result.dudas = [prevBriefing?.dudas.length ?? 0, r.data.dudas.length];
          await sb.from('projects').update({ briefing: r.data, briefing_md: `${updateHeader(u)}\n\n${briefingToMarkdown(r.data)}` }).eq('id', projectId);
        }),
    );
  }
  if (!scopeEdited) {
    tasks.push(
      llm()
        .run({
          task: 'alcance',
          tier: 'smart',
          system: SYSTEM_SCOPE,
          content: [
            {
              type: 'text',
              text: `${dossier(b, { includeInternal: true })}\n\n${novedad}${
                prevScope ? `\n\nALCANCE ANTERIOR (JSON). Parte de él: conserva EXACTAMENTE el nombre de cada partida que siga vigente (aunque ajustes su detalle), añade partidas nuevas solo si la novedad las exige, quita solo las que la novedad descarte, y elimina de "a_confirmar" lo que la novedad ya confirma:\n${JSON.stringify({ incluye: prevScope.incluye, no_incluye: prevScope.no_incluye, a_confirmar: prevScope.a_confirmar, supuestos: prevScope.supuestos })}` : ''
              }\n\nDevuelve el alcance técnico preliminar actualizado completo.`,
            },
          ],
          toolName: 'guardar_alcance',
          toolDescription: 'Guarda el alcance preliminar actualizado (borrador)',
          schema: ScopeSchema,
          maxTokens: 3000,
        })
        .then(async (r) => {
          const before = new Set((prevScope?.incluye ?? []).map((i) => i.partida.toLowerCase()));
          const after = new Set(r.data.incluye.map((i) => i.partida.toLowerCase()));
          result.partidasNuevas = r.data.incluye.filter((i) => !before.has(i.partida.toLowerCase())).map((i) => i.partida);
          result.partidasQuitadas = (prevScope?.incluye ?? []).filter((i) => !after.has(i.partida.toLowerCase())).map((i) => i.partida);
          await sb.from('projects').update({ scope: { ...r.data, borrador: true }, scope_md: `${updateHeader(u)}\n\n${scopeToMarkdown(r.data)}` }).eq('id', projectId);
        }),
    );
  }
  const settled = await Promise.allSettled(tasks);
  const failed = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
  if (failed) throw failed.reason;
  await audit('expediente_actualizado_por_personal', { projectId, payload: { emailId, autor: u.author, canal: u.channel, ...result } });
  return result;
}
