import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkIntegrationAuth } from '@/integrations/whatsapp';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/core/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  projectId: z.string().uuid(),
  /** null = volver al modo por defecto de Ajustes */
  mode: z.enum(['solo_recibir', 'borrador', 'asistente', 'solo_equipo']).nullable(),
  by: z.string().max(120).nullish(),
});

/** Cambiar desde la bandeja de WhatsApp el modo de respuesta de un expediente. */
export async function POST(req: Request) {
  if (!checkIntegrationAuth(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Petición no válida' }, { status: 400 });
  const { error } = await supabaseAdmin().from('projects').update({ wa_reply_mode: parsed.data.mode }).eq('id', parsed.data.projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit('modo_whatsapp_cambiado', { projectId: parsed.data.projectId, actorType: 'sistema', payload: { modo: parsed.data.mode, desde: 'bandeja de WhatsApp', por: parsed.data.by ?? null } });
  return NextResponse.json({ ok: true });
}
