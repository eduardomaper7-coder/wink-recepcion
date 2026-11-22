import { supabaseAdmin } from '@/lib/supabase/admin';
import { log } from '@/lib/log';

export interface StepDef {
  key: string;
  task: number;
  label: string;
}

/** Pasos de un encargo nuevo (las 6 tareas del agente + recepción). */
export const NEW_STEPS: StepDef[] = [
  { key: 't0_recepcion', task: 0, label: 'Correo recibido y remitente identificado' },
  { key: 't1_expediente', task: 1, label: 'Expediente digital' },
  { key: 't2_documentos', task: 2, label: 'Inventario documental' },
  { key: 't3_briefing', task: 3, label: 'Briefing técnico' },
  { key: 't4_pendientes', task: 4, label: 'Listado de pendientes y correo al cliente' },
  { key: 't5_alcance', task: 5, label: 'Alcance preliminar' },
  { key: 't6_visita', task: 6, label: 'Checklist y planificación de la visita' },
];

/** Pasos de una respuesta en un hilo existente. */
export const REPLY_STEPS: StepDef[] = [
  { key: 't0_recepcion', task: 0, label: 'Correo recibido y remitente identificado' },
  { key: 'r1_vinculo', task: 1, label: 'Vinculado al expediente' },
  { key: 'r2_documentos', task: 2, label: 'Documentos nuevos clasificados' },
  { key: 'r4_pendientes', task: 4, label: 'Pendientes actualizados' },
  { key: 'r5_tecnico', task: 5, label: 'Briefing y alcance actualizados' },
  { key: 'r6_visita', task: 6, label: 'Visita' },
  { key: 'r7_aviso', task: 7, label: 'Aviso al arquitecto y al responsable' },
];

export const stepDef = (key: string): StepDef => [...NEW_STEPS, ...REPLY_STEPS].find((s) => s.key === key)!;

export async function initSteps(emailId: string, defs: StepDef[], projectId: string | null = null) {
  const rows = defs.map((d) => ({ email_id: emailId, project_id: projectId, step: d.key, task_no: d.task, label: d.label, status: 'pendiente' }));
  await supabaseAdmin().from('agent_steps').upsert(rows, { onConflict: 'email_id,step', ignoreDuplicates: true });
}

export async function attachProjectToSteps(emailId: string, projectId: string) {
  await supabaseAdmin().from('agent_steps').update({ project_id: projectId }).eq('email_id', emailId);
}

export async function skipRemainingSteps(emailId: string, detail: string) {
  await supabaseAdmin().from('agent_steps').update({ status: 'omitido', detail }).eq('email_id', emailId).eq('status', 'pendiente');
}

export interface StepOutcome<T> {
  output: T;
  detail?: string;
  model?: string;
  usage?: { input: number; output: number };
}

/**
 * Ejecuta un paso con checkpoint: si ya terminó bien en un intento anterior, devuelve su salida
 * guardada sin repetir trabajo (idempotencia ante reintentos de la cola).
 */
export async function runStep<T>(emailId: string, key: string, fn: () => Promise<StepOutcome<T>>, projectId?: string | null): Promise<T> {
  const sb = supabaseAdmin();
  const def = stepDef(key);
  const { data: existing } = await sb.from('agent_steps').select('status,output').eq('email_id', emailId).eq('step', key).maybeSingle();
  if (existing?.status === 'ok' && existing.output !== null) return existing.output as T;

  const startedAt = new Date().toISOString();
  await sb.from('agent_steps').upsert(
    {
      email_id: emailId,
      project_id: projectId ?? null,
      step: key,
      task_no: def.task,
      label: def.label,
      status: 'en_curso',
      started_at: startedAt,
      error: null,
    },
    { onConflict: 'email_id,step' },
  );
  try {
    const r = await fn();
    await sb
      .from('agent_steps')
      .update({
        status: 'ok',
        output: (r.output ?? {}) as object,
        detail: r.detail ?? null,
        model: r.model ?? null,
        input_tokens: r.usage?.input ?? null,
        output_tokens: r.usage?.output ?? null,
        finished_at: new Date().toISOString(),
        ...(projectId ? { project_id: projectId } : {}),
      })
      .eq('email_id', emailId)
      .eq('step', key);
    return r.output;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`Paso ${key} con error`, { emailId, error: msg });
    await sb.from('agent_steps').update({ status: 'error', error: msg.slice(0, 500), finished_at: new Date().toISOString() }).eq('email_id', emailId).eq('step', key);
    throw e;
  }
}
