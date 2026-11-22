import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { signedUrl } from '@/storage/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vista previa de un documento: redirige a una URL firmada de 5 minutos. */
export async function GET(_req: Request, ctx: { params: Promise<{ docId: string }> }) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const { docId } = await ctx.params;
  const { data: doc } = await supabaseAdmin().from('documents').select('storage_path').eq('id', docId).single();
  if (!doc) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  const url = await signedUrl(doc.storage_path, 300);
  if (!url) return NextResponse.json({ error: 'No disponible' }, { status: 404 });
  return NextResponse.redirect(url);
}
