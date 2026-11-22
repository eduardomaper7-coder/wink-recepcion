/**
 * Borradores de correo. Regla: ningún correo al cliente sale sin aprobación de un arquitecto
 * (requires_approval = true). Los avisos internos al personal pueden enviarse solos si
 * settings.auto_send_internal está activo.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { llm } from './llm';
import { ClientEmailSchema } from './schemas';
import { SYSTEM_CLIENT_EMAIL } from './prompts';
import { checkClientEmail, type ComplianceFlag } from './compliance';
import { clientSafe, formatDateEs } from '@/lib/text';
import type { PendingResult } from './pending';

export interface DraftInput {
  projectId: string;
  kind: 'pendientes_y_visita' | 'recordatorio' | 'solicitud_interna' | 'aviso_interno' | 'confirmacion_visita' | 'respuesta';
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  inReplyToEmailId?: string | null;
  requiresApproval: boolean;
  flags?: string[];
  channel?: 'email' | 'whatsapp';
  waConversationId?: string | null;
}

export async function saveDraft(d: DraftInput): Promise<string> {
  const sb = supabaseAdmin();
  // Un único borrador abierto por tipo y expediente: el nuevo sustituye al anterior
  await sb.from('email_drafts').update({ status: 'descartado' }).eq('project_id', d.projectId).eq('kind', d.kind).eq('status', 'borrador');
  const { data, error } = await sb
    .from('email_drafts')
    .insert({
      project_id: d.projectId,
      kind: d.kind,
      to_emails: d.to,
      cc_emails: d.cc,
      subject: d.subject,
      body_text: d.body,
      in_reply_to_email_id: d.inReplyToEmailId ?? null,
      requires_approval: d.requiresApproval,
      compliance_flags: d.flags ?? [],
      channel: d.channel ?? 'email',
      wa_conversation_id: d.waConversationId ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`No se pudo guardar el borrador: ${error.message}`);
  return data.id;
}

export interface ClientEmailContext {
  clientName: string | null;
  clientRequestSummary: string | null; // SOLO lo que dijo el cliente, nunca notas internas
  originalSubject: string | null;
  required: PendingResult[];
  optional: PendingResult[];
  slots: { start: Date; end: Date }[];
  internalNotes: string | null; // solo para el control de fugas, no se envía al modelo
  signature: string;
  isFirstContactFromWink: boolean; // el cliente no nos escribió (reenvío/encargo del personal)
  channel?: 'email' | 'whatsapp';
  /** Visita ya reservada: se confirma en vez de proponer huecos */
  visitAt?: Date | null;
  /** El cliente ha preguntado por precio/coste o por plazos/duración */
  clientAskedPriceOrTime?: boolean;
}

/** Detecta (sin IA) si el cliente pregunta por precio o por plazos, para responderle sin dar cifras. */
export function asksPriceOrTime(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return /cu[aá]nto (me )?(costar[ií]a|cuesta|vale|saldr[ií]a)|precio|presupuesto aproximado|coste aproximado|cu[aá]nto tiempo|cu[aá]nto (durar[ií]a|tardar[ií]ais|llevar[ií]a)|plazo de (la )?obra|duraci[oó]n de (la )?obra/.test(t);
}

export function formatSlots(slots: { start: Date; end: Date }[]): string[] {
  return slots.map((s, i) => {
    const end = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(s.end);
    return `${i + 1}. ${formatDateEs(s.start)} – ${end}`;
  });
}

export async function composeClientEmail(c: ClientEmailContext): Promise<{ subject: string; body: string; flags: ComplianceFlag[]; model: string; usage: { input: number; output: number } }> {
  const facts = [
    `Nombre del cliente: ${clientSafe(c.clientName) ?? '(desconocido: usar saludo genérico "Buenos días")'}`,
    `Qué ha pedido el cliente: ${clientSafe(c.clientRequestSummary) ?? 'una reforma de su vivienda'}`,
    c.isFirstContactFromWink
      ? 'Contexto: el cliente habló antes con una persona de Wink, que nos ha trasladado su solicitud. Es el primer correo que recibe desde este buzón.'
      : 'Contexto: el cliente nos escribió directamente; esto es nuestra respuesta.',
    `Asunto original: ${c.originalSubject ?? '(sin asunto)'}`,
    ...(c.clientAskedPriceOrTime
      ? ['IMPORTANTE: el cliente pregunta cuánto costaría y/o cuánto duraría la obra. Respóndele en UNA frase, antes de la lista de documentación, que el presupuesto y los plazos los valoraremos después de la visita y del estudio del encargo. Sin cifras ni horquillas.']
      : []),
    '',
    'Documentación e información que necesitamos (obligatoria):',
    ...(c.required.length ? c.required.map((r) => `- ${clientSafe(r.description)}${r.note ? ` (${clientSafe(r.note)})` : ''}`) : ['- (nada pendiente)']),
    '',
    'Documentación opcional (pedir "si dispone de ella"):',
    ...(c.optional.length ? c.optional.map((r) => `- ${r.description}`) : ['- (ninguna)']),
    '',
    ...(c.visitAt
      ? [`Visita al inmueble YA RESERVADA para el ${formatDateEs(c.visitAt)}: recuérdala y no propongas otras fechas.`]
      : ['Opciones de visita al inmueble (copiar tal cual, numeradas):', ...(c.slots.length ? formatSlots(c.slots) : ['(sin huecos disponibles: indicar que le propondremos fecha en breve)'])]),
    ...(c.channel === 'whatsapp'
      ? [
          '',
          'CANAL: WhatsApp. El cliente habló antes con el asistente de Wink por WhatsApp. Escribe un mensaje de WhatsApp: breve (máx. 120 palabras), cercano, trato de usted, viñetas con "• ", sin saludo de correo ni despedida larga. El "asunto" es solo un título interno de 3-6 palabras.',
        ]
      : []),
  ].join('\n');

  let usage = { input: 0, output: 0 };
  let model = '';
  let last: { asunto: string; cuerpo: string } | null = null;
  let flags: ComplianceFlag[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const extra = attempt === 0 ? '' : `\n\nATENCIÓN: el borrador anterior incumplía estas reglas: ${flags.map((f) => `${f.code} («${f.match}»)`).join(', ')}. Redáctalo de nuevo sin ese contenido.`;
    const r = await llm().run({
      task: 'correo_cliente',
      tier: 'smart',
      system: SYSTEM_CLIENT_EMAIL,
      content: [{ type: 'text', text: `${facts}${extra}` }],
      toolName: 'redactar_correo',
      toolDescription: 'Devuelve el asunto y el cuerpo del correo al cliente',
      schema: ClientEmailSchema,
      maxTokens: 1500,
    });
    usage = { input: usage.input + r.usage.input, output: usage.output + r.usage.output };
    model = r.model;
    last = r.data;
    flags = checkClientEmail(`${r.data.asunto}\n${r.data.cuerpo}`, c.internalNotes);
    if (!flags.length) break;
  }
  const subject = c.channel !== 'whatsapp' && c.originalSubject && !c.isFirstContactFromWink ? `Re: ${c.originalSubject.replace(/^(re|rv|fw|fwd):\s*/i, '')}` : last!.asunto;
  // Última red de seguridad: ninguna anotación interna sale en el correo
  const signature = c.channel === 'whatsapp' ? '— Equipo Wink' : c.signature;
  return { subject: clientSafe(subject)!, body: `${stripClosing(clientSafe(last!.cuerpo.trim())!, signature)}\n\n${signature}`, flags, model, usage };
}

/** Solicitud interna (plantilla fija, sin LLM): faltan datos de contacto del cliente. */
export function internalContactRequest(opts: { staffName: string; projectCode: string; clientName: string | null; missing: string[]; appUrl: string }) {
  const first = opts.staffName.split(' ')[0];
  return {
    subject: `[${opts.projectCode}] Faltan datos de contacto del cliente`,
    body: [
      `Hola, ${first}:`,
      '',
      `He abierto el expediente ${opts.projectCode}${opts.clientName ? ` (${opts.clientName})` : ''} con la información que nos has enviado.`,
      '',
      `Para poder escribir al cliente me falta: ${opts.missing.join(' y ')}.`,
      'Responde a este correo con el dato y continúo con el expediente.',
      '',
      `Expediente: ${opts.appUrl}/expedientes`,
      '',
      'Agente de recepción de encargos · Wink Group',
    ].join('\n'),
  };
}

/** Aviso interno cuando el cliente responde (plantilla fija). */
export function internalUpdateNotice(opts: { projectCode: string; clientName: string | null; lines: string[]; appUrl: string; projectId: string }) {
  return {
    subject: `[${opts.projectCode}] Novedades del cliente${opts.clientName ? `: ${opts.clientName}` : ''}`,
    body: [
      `Hay novedades en el expediente ${opts.projectCode}:`,
      '',
      ...opts.lines.map((l) => `- ${l}`),
      '',
      `Revisar: ${opts.appUrl}/expedientes/${opts.projectId}`,
      '',
      'Agente de recepción de encargos · Wink Group',
    ].join('\n'),
  };
}

export function visitConfirmationEmail(opts: { clientName: string | null; when: Date; address: string | null; signature: string }) {
  return {
    body: [
      `${opts.clientName ? `Buenos días, ${opts.clientName.split(' ')[0]}:` : 'Buenos días:'}`,
      '',
      `Le confirmamos la visita al inmueble${opts.address ? ` de ${clientSafe(opts.address)}` : ''} el ${formatDateEs(opts.when)}.`,
      'Si necesita cambiarla, basta con responder a este correo.',
      '',
      opts.signature,
    ].join('\n'),
  };
}

export function reminderEmail(opts: { clientName: string | null; items: string[]; signature: string }) {
  return [
    `${opts.clientName ? `Buenos días, ${opts.clientName.split(' ')[0]}:` : 'Buenos días:'}`,
    '',
    'Le escribimos para recordarle que, para avanzar con su encargo, todavía necesitamos:',
    '',
    ...opts.items.map((i) => `- ${clientSafe(i)}`),
    '',
    'Puede enviárnoslo respondiendo a este mismo correo. Si tiene cualquier duda, estamos a su disposición.',
    '',
    opts.signature,
  ].join('\n');
}

const CLOSING = /^(un\s+)?(cordial\s+|afectuoso\s+)?saludos?[,.!]?$|^atentamente[,.]?$|^reciba un cordial saludo[,.]?$|^saludos cordiales[,.]?$/i;

/** Si la firma ya trae despedida ("Un saludo,"), quita la despedida que haya escrito el modelo al final del cuerpo. */
export function stripClosing(body: string, signature: string): string {
  const firstSig = signature.split('\n')[0].trim();
  if (!CLOSING.test(firstSig)) return body;
  const paras = body.split(/\n\s*\n/);
  while (paras.length > 1 && CLOSING.test(paras[paras.length - 1].trim())) paras.pop();
  return paras.join('\n\n').trim();
}
