import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ruta temporal de limpieza: borra archivos del Storage por prefijo (solo con CRON_SECRET).
export async function POST(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { bucket, prefixes } = (await req.json()) as { bucket: string; prefixes: string[] };
  const sb = supabaseAdmin();
  const listAll = async (prefix: string): Promise<string[]> => {
    const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw error;
    const out: string[] = [];
    for (const f of data ?? []) {
      const p = `${prefix}/${f.name}`;
      if (f.id === null) out.push(...(await listAll(p)));
      else out.push(p);
    }
    return out;
  };
  const result: Record<string, number | string> = {};
  for (const pre of prefixes) {
    try {
      const files = await listAll(pre);
      if (!files.length) { result[pre] = 0; continue; }
      const { data, error } = await sb.storage.from(bucket).remove(files);
      result[pre] = error ? `error: ${error.message}` : (data?.length ?? 0);
    } catch (e) {
      result[pre] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return NextResponse.json(result);
}
