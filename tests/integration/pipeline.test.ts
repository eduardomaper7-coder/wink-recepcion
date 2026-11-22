/**
 * Test de integración de punta a punta contra un proyecto de Supabase REAL (base de datos,
 * storage y cola), con el modelo sustituido por un doble determinista (FakeLlm).
 *
 * ⚠ BORRA los datos de demo del proyecto configurado. Solo se ejecuta con:
 *    INTEGRATION_ALLOW_RESET=true EMAIL_PROVIDER=fixture DEMO_MODE=true npm run test:integration
 *
 * Escenarios cubiertos (los 8 pedidos):
 *  1. Encargo del cliente (directo) ................................. caso2
 *  2. Encargo con documentos faltantes + incoherencia + duplicado de foto  caso1
 *  3. Correo reenviado por el personal .............................. caso1
 *  4. Encargo escrito por el personal sin email del cliente ......... caso3 (+ respuesta con el email)
 *  5. Mismo encargo por las dos vías ................................ caso2 + caso2b
 *  6. Respuesta del cliente con documentos nuevos ................... respuesta_docs
 *  7. Confirmación de visita ........................................ respuesta_visita
 *  8. Correo que no es un encargo ................................... caso4
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { setLlm } from '@/agent/llm';
import { FakeLlm } from '../helpers/fake-llm';
import { injectDemoCase } from '@/demo/fixtures';
import { runWorker } from '@/queue/worker';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendDraft } from '@/agent/send';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseRawEmail } from '@/email/parse';
import { ingestEmail } from '@/ingest/ingest';

const enabled = process.env.INTEGRATION_ALLOW_RESET === 'true' && process.env.EMAIL_PROVIDER === 'fixture';
const d = enabled ? describe : describe.skip;
const sb = () => supabaseAdmin();

async function inject(k: Parameters<typeof injectDemoCase>[0]) {
  const r = await injectDemoCase(k);
  await runWorker({ budgetMs: 120_000, concurrency: 1 });
  return r.emailId!;
}
const projectOf = async (emailId: string) => (await sb().from('emails').select('project_id').eq('id', emailId).single()).data!.project_id as string;

d('pipeline completo (Supabase real + modelo simulado)', () => {
  beforeAll(async () => {
    setLlm(new FakeLlm());
    const { execSync } = await import('node:child_process');
    execSync('npx tsx scripts/demo-reset.ts --yes', { stdio: 'inherit' });
  });

  let caso1Project = '';
  let caso2Project = '';

  it('caso 1 — reenvío del personal: cliente = remitente original, responsable = quien reenvía', async () => {
    const emailId = await inject('caso1');
    caso1Project = await projectOf(emailId);
    const { data: p } = await sb().from('projects').select('code,origin,status,responsible:responsible_staff_id(email),clients(email,full_name)').eq('id', caso1Project).single();
    expect(p!.code).toMatch(/^WNK-\d{4}-0001$/);
    expect(p!.origin).toBe('reenvio_personal');
    expect(p!.status).toBe('pendiente_revision');
    expect((p!.clients as unknown as { email: string }).email).toBe('lucia.fernandez.demo@gmail.com');
    expect((p!.responsible as unknown as { email: string }).email).toBe('laura.martin@winkgroup.es');
  });

  it('caso 1 — inventario: 8 archivos, 1 duplicado, renombrados y en su carpeta', async () => {
    const { data: docs } = await sb().from('documents').select('doc_type,status,folder,new_name').eq('project_id', caso1Project);
    expect(docs).toHaveLength(8);
    expect(docs!.filter((x) => x.status === 'duplicado')).toHaveLength(1);
    expect(docs!.find((x) => x.doc_type === 'nota_simple')?.folder).toBe('04_Documentacion_legal');
    expect(docs!.find((x) => x.doc_type === 'plano')?.new_name).toMatch(/^WNK-\d{4}-0001_plano_/);
  });

  it('caso 1 — pendientes (certificado energético, plano completo) e incoherencia de superficie', async () => {
    const { data: pend } = await sb().from('pending_items').select('description,status').eq('project_id', caso1Project);
    const open = pend!.filter((x) => x.status === 'pendiente').map((x) => x.description).join(' | ');
    expect(open).toMatch(/Certificado de eficiencia energ/);
    expect(open).toMatch(/Planos del estado actual/);
    expect(open).not.toMatch(/Nota simple/);
    const { data: inc } = await sb().from('inconsistencies').select('field').eq('project_id', caso1Project);
    expect(inc!.map((i) => i.field)).toContain('property.surface_m2');
  });

  it('caso 1 — el correo al cliente es un borrador que exige aprobación, con el responsable en copia', async () => {
    const { data: dr } = await sb().from('email_drafts').select('*').eq('project_id', caso1Project).eq('kind', 'pendientes_y_visita').eq('status', 'borrador').single();
    expect(dr!.requires_approval).toBe(true);
    expect(dr!.to_emails).toEqual(['lucia.fernandez.demo@gmail.com']);
    expect(dr!.cc_emails).toEqual(['laura.martin@winkgroup.es']);
    await expect(sendDraft(dr!.id, null)).rejects.toThrow(/aprobación/);
  });

  it('caso 1 — tras aprobar y enviar, la respuesta con documentos actualiza pendientes (escenario 6)', async () => {
    const { data: dr } = await sb().from('email_drafts').select('id').eq('project_id', caso1Project).eq('kind', 'pendientes_y_visita').eq('status', 'borrador').single();
    const { data: anyUser } = await sb().auth.admin.listUsers({ page: 1, perPage: 1 });
    await sendDraft(dr!.id, anyUser.users[0]?.id ?? '00000000-0000-0000-0000-000000000000');
    expect((await sb().from('projects').select('status').eq('id', caso1Project).single()).data!.status).toBe('esperando_cliente');

    const emailId = await inject('respuesta_docs');
    expect(await projectOf(emailId)).toBe(caso1Project);
    const { data: pend } = await sb().from('pending_items').select('description,status').eq('project_id', caso1Project);
    expect(pend!.find((x) => /energ/.test(x.description))?.status).toBe('recibido');
    expect(pend!.find((x) => /Planos del estado actual/.test(x.description))?.status).toBe('recibido');
  });

  it('caso 1 — confirmación de visita: se registra en la agenda y en el expediente (escenario 7)', async () => {
    await inject('respuesta_visita');
    const { data: p } = await sb().from('projects').select('status,visit_at,visit_event_id').eq('id', caso1Project).single();
    expect(p!.status).toBe('visita_agendada');
    expect(p!.visit_at).not.toBeNull();
    expect(p!.visit_event_id).toMatch(/^mock-/);
  });

  it('caso 2 — cliente directo: sin responsable asignado', async () => {
    const emailId = await inject('caso2');
    caso2Project = await projectOf(emailId);
    const { data: p } = await sb().from('projects').select('origin,responsible_staff_id').eq('id', caso2Project).single();
    expect(p!.origin).toBe('cliente_directo');
    expect(p!.responsible_staff_id).toBeNull();
  });

  it('caso 2b — el mismo encargo por la otra vía se une al expediente y asigna responsable (escenario 5)', async () => {
    const emailId = await inject('caso2_duplicado');
    expect(await projectOf(emailId)).toBe(caso2Project);
    const { count } = await sb().from('projects').select('id', { count: 'exact', head: true });
    expect(count).toBe(2);
    const { data: p } = await sb().from('projects').select('responsible:responsible_staff_id(email)').eq('id', caso2Project).single();
    expect((p!.responsible as unknown as { email: string }).email).toBe('carlos.ruiz@winkgroup.es');
  });

  it('caso 3 — personal sin email del cliente: se pide primero a la persona de Wink (escenario 4)', async () => {
    const emailId = await inject('caso3');
    const pid = await projectOf(emailId);
    const { data: p } = await sb().from('projects').select('status').eq('id', pid).single();
    expect(p!.status).toBe('esperando_datos_internos');
    const { data: drafts } = await sb().from('email_drafts').select('kind,status,to_emails').eq('project_id', pid);
    expect(drafts!.some((x) => x.kind === 'pendientes_y_visita')).toBe(false);
    const internal = drafts!.find((x) => x.kind === 'solicitud_interna');
    expect(internal?.status).toBe('enviado');
    expect(internal?.to_emails).toEqual(['laura.martin@winkgroup.es']);

    // Laura responde en el hilo con el email → se prepara el correo al cliente
    const { data: out } = await sb().from('emails').select('message_id_header').eq('project_id', pid).eq('direction', 'saliente').single();
    const raw = await readFile(path.join(process.cwd(), 'demo/fixtures/caso3_respuesta_personal_email.eml'));
    const reply = await parseRawEmail(raw, 'fixture', `test-${Date.now()}`);
    reply.messageId = `<test-${Date.now()}@demo.wink>`;
    reply.inReplyTo = out!.message_id_header;
    reply.references = [out!.message_id_header];
    await ingestEmail(reply);
    await runWorker({ budgetMs: 120_000, concurrency: 1 });
    const { data: p2 } = await sb().from('projects').select('status,clients(email)').eq('id', pid).single();
    expect((p2!.clients as unknown as { email: string }).email).toBe('marta.gomez.demo@gmail.com');
    expect(p2!.status).toBe('pendiente_revision');
    const { data: d2 } = await sb().from('email_drafts').select('to_emails').eq('project_id', pid).eq('kind', 'pendientes_y_visita').eq('status', 'borrador').single();
    expect(d2!.to_emails).toEqual(['marta.gomez.demo@gmail.com']);
  });

  it('caso 4 — no es un encargo: queda en la bandeja sin crear expediente (escenario 8)', async () => {
    const emailId = await inject('caso4');
    const { data: e } = await sb().from('emails').select('classification,processing_status,project_id').eq('id', emailId).single();
    expect(e!.classification).toBe('no_encargo');
    expect(e!.processing_status).toBe('ignorado');
    expect(e!.project_id).toBeNull();
  });

  it('idempotencia: el mismo Message-ID no se procesa dos veces', async () => {
    const raw = await readFile(path.join(process.cwd(), 'demo/fixtures/caso4_no_encargo.eml'));
    const m = await parseRawEmail(raw, 'fixture', 'idem-1');
    m.messageId = '<idempotencia@test>';
    const a = await ingestEmail(m);
    const b = await ingestEmail({ ...m, providerMessageId: 'idem-2' });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.emailId).toBe(a.emailId);
  });
});
