import { supabaseAdmin } from '@/lib/supabase/admin';

export type JobType = 'process_email' | 'send_reminders';

export interface Job {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

/** Encola un trabajo. dedupeKey garantiza idempotencia (p. ej. un trabajo por correo). */
export async function enqueue(type: JobType, payload: Record<string, unknown>, dedupeKey?: string) {
  const { error } = await supabaseAdmin()
    .from('jobs')
    .upsert({ type, payload, dedupe_key: dedupeKey ?? null }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) throw new Error(`No se pudo encolar ${type}: ${error.message}`);
}

export async function claimJobs(limit = 3): Promise<Job[]> {
  const { data, error } = await supabaseAdmin().rpc('claim_jobs', { p_limit: limit, p_lock_seconds: 290 });
  if (error) throw new Error(`claim_jobs: ${error.message}`);
  return (data ?? []) as Job[];
}

export async function finishJob(id: string, ok: boolean, errorMsg?: string) {
  await supabaseAdmin().rpc('finish_job', { p_id: id, p_ok: ok, p_error: errorMsg ?? null });
}
