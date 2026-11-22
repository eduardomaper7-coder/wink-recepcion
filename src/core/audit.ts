import { supabaseAdmin } from '@/lib/supabase/admin';
import { log } from '@/lib/log';

/**
 * Auditoría: todo lo que hace el agente y quién aprueba qué.
 * El payload nunca debe llevar datos personales completos (solo ids, recuentos, tipos).
 */
export async function audit(
  action: string,
  opts: { projectId?: string | null; actorType?: 'agente' | 'usuario' | 'sistema'; actorId?: string | null; payload?: Record<string, unknown> } = {},
) {
  const { error } = await supabaseAdmin()
    .from('events')
    .insert({
      project_id: opts.projectId ?? null,
      actor_type: opts.actorType ?? 'agente',
      actor_id: opts.actorId ?? null,
      action,
      payload: opts.payload ?? {},
    });
  if (error) log.warn('No se pudo registrar el evento de auditoría', { action, error: error.message });
}
