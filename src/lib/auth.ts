import 'server-only';
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import { supabaseAdmin } from './supabase/admin';

export interface SessionUser {
  id: string;
  email: string | null;
  role: 'admin' | 'arquitecto';
  staffId: string | null;
  staffName: string | null;
}

/** Usuario autenticado con perfil del equipo, o null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: profile } = await supabaseAdmin().from('profiles').select('role,staff_id,staff:staff_id(full_name)').eq('user_id', data.user.id).maybeSingle();
  if (!profile) return null;
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    role: profile.role,
    staffId: profile.staff_id,
    staffName: (profile.staff as unknown as { full_name: string } | null)?.full_name ?? null,
  };
}

/** Para páginas: redirige a /login si no hay sesión válida. */
export async function requirePageUser(opts: { admin?: boolean } = {}): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  if (opts.admin && u.role !== 'admin') redirect('/expedientes');
  return u;
}

/** Para acciones y rutas: lanza error si no hay permiso. */
export async function requireUser(opts: { admin?: boolean } = {}): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error('No autorizado');
  if (opts.admin && u.role !== 'admin') throw new Error('Solo administradores');
  return u;
}

/** Endpoints internos (cron/worker): Authorization: Bearer CRON_SECRET */
export function checkCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const h = req.headers.get('authorization') ?? '';
  return h === `Bearer ${secret}`;
}
