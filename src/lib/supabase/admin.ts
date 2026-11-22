import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';

let client: SupabaseClient | null = null;

/**
 * Cliente con service_role: SOLO para el servidor (agente, worker, acciones verificadas).
 * Ignora RLS, así que cada acción de usuario debe comprobar antes el rol (ver lib/auth.ts).
 */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const e = env();
  client = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
