import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkIntegrationAuth, findProjectForWhatsApp, findStaffByPhone, phoneFromWa, projectOptionsForStaff, resolveMode, type LookupResult } from '@/integrations/whatsapp';
import { loadSettings, loadStaff, type WaReplyMode } from '@/core/settings';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/config/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ waId: z.string().min(6), conversationId: z.string().nullish() });

/** ¿Quién es este número de WhatsApp para Wink y cómo hay que responderle? */
export async function POST(req: Request) {
  if (!checkIntegrationAuth(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Petición no válida' }, { status: 400 });
  const phone = phoneFromWa(parsed.data.waId);
  const [settings, staff] = await Promise.all([loadSettings(), loadStaff()]);
  const base = env().APP_BASE_URL.replace(/\/$/, '');

  const member = findStaffByPhone(phone, staff);
  if (member) {
    const r = resolveMode('personal', settings.wa_reply_modes, null);
    const result: LookupResult = {
      kind: 'personal',
      staff: { id: member.id, name: member.full_name },
      client: null,
      project: null,
      mode: r.mode,
      modeSource: r.source,
      projectOptions: await projectOptionsForStaff(member.id),
    };
    return NextResponse.json(result);
  }

  const project = await findProjectForWhatsApp({ waConversationId: parsed.data.conversationId, phone });
  const { data: client } = project?.client_id
    ? await supabaseAdmin().from('clients').select('id,full_name,email').eq('id', project.client_id).single()
    : phone
      ? await supabaseAdmin().from('clients').select('id,full_name,email').eq('phone', phone).limit(1).maybeSingle()
      : { data: null };
  const kind = project ? 'cliente_con_expediente' : client ? 'cliente' : 'desconocido';
  const r = resolveMode(kind, settings.wa_reply_modes, (project?.wa_reply_mode as WaReplyMode | null) ?? null);
  const result: LookupResult = {
    kind,
    staff: null,
    client: client ? { id: client.id, name: client.full_name, email: client.email } : null,
    project: project ? { id: project.id, code: project.code, title: project.title, status: project.status, url: `${base}/expedientes/${project.id}` } : null,
    mode: r.mode,
    modeSource: r.source,
    projectOptions: [],
  };
  return NextResponse.json(result);
}
