/**
 * Casos de demo FICTICIOS. Los .eml se generan con scripts/generate-fixtures.py y se inyectan
 * por el mismo pipeline que un correo real (proveedor "fixture"). Cada inyección recibe un
 * Message-ID nuevo para poder repetir la demo sin chocar con la idempotencia.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseRawEmail } from '@/email/parse';
import { ingestEmail } from '@/ingest/ingest';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const DEMO_CASES = {
  caso1: { file: 'caso1_reenvio_personal.eml', label: 'Caso 1 · Reenvío de Laura (Wink) con fotos, plano y nota simple' },
  caso2: { file: 'caso2_cliente_directo.eml', label: 'Caso 2 · El cliente escribe directamente' },
  caso2_duplicado: { file: 'caso2b_mismo_encargo_personal.eml', label: 'Caso 2b · El mismo encargo llega reenviado por el personal' },
  caso3: { file: 'caso3_personal_sin_email.eml', label: 'Caso 3 · Encargo escrito por el personal sin email del cliente' },
  caso4: { file: 'caso4_no_encargo.eml', label: 'Caso 4 · Correo que no es un encargo' },
  respuesta_docs: { file: 'respuesta_cliente_documentos.eml', label: 'Respuesta del cliente del caso 1 con documentos nuevos', replyTo: 'caso1' },
  respuesta_visita: { file: 'respuesta_cliente_confirma_visita.eml', label: 'El cliente del caso 1 confirma la visita', replyTo: 'caso1' },
} as const;
export type DemoCase = keyof typeof DEMO_CASES;

export const FIXTURES_DIR = path.join(process.cwd(), 'demo', 'fixtures');

/** Último correo saliente del expediente del caso indicado (para encadenar las respuestas al hilo). */
async function threadParentFor(caseKey: DemoCase): Promise<{ messageId: string; refs: string[] } | null> {
  const sb = supabaseAdmin();
  const marker = caseKey === 'caso1' ? 'Lucía Fernández' : null;
  if (!marker) return null;
  const { data: client } = await sb.from('clients').select('id').eq('full_name', marker).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!client) return null;
  const { data: project } = await sb.from('projects').select('id').eq('client_id', client.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!project) return null;
  const { data: last } = await sb
    .from('emails')
    .select('message_id_header,references_ids')
    .eq('project_id', project.id)
    .eq('direction', 'saliente')
    .not('message_id_header', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return null;
  return { messageId: last.message_id_header, refs: [...(last.references_ids ?? []), last.message_id_header] };
}

export async function injectDemoCase(caseKey: DemoCase) {
  const def = DEMO_CASES[caseKey];
  const raw = await readFile(path.join(FIXTURES_DIR, def.file));
  const email = await parseRawEmail(raw, 'fixture', `demo-${caseKey}-${Date.now()}`);
  email.messageId = `<demo-${randomUUID()}@demo.wink>`;
  email.date = new Date();
  if ('replyTo' in def) {
    const parent = await threadParentFor(def.replyTo);
    if (!parent) throw new Error('Primero hay que lanzar el caso 1 y aprobar/enviar su correo al cliente');
    email.inReplyTo = parent.messageId;
    email.references = parent.refs;
  }
  return ingestEmail(email);
}
