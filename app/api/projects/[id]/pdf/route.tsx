import { NextResponse } from 'next/server';
import path from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ExpedientePdf, type PdfData } from '@/pdf/ExpedientePdf';
import { DOC_STATUS_LABEL, DOC_TYPE_LABEL, ORIGIN_LABEL, PENDING_STATUS_LABEL, STATUS_LABEL } from '@/core/labels';
import { formatDateEs } from '@/lib/text';
import { audit } from '@/core/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: p } = await sb.from('projects').select('*, clients(*), properties(*), responsible:responsible_staff_id(full_name)').eq('id', id).single();
  if (!p) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
  const [docs, pend, inc, slots, approver] = await Promise.all([
    sb.from('documents').select('new_name,original_name,doc_type,status,description').eq('project_id', id).order('folder').order('created_at'),
    sb.from('pending_items').select('description,status').eq('project_id', id).neq('status', 'descartado').order('sort'),
    sb.from('inconsistencies').select('description').eq('project_id', id).is('resolved_at', null),
    sb.from('visit_slots').select('starts_at,status').eq('project_id', id).neq('status', 'descartado').order('starts_at'),
    p.approved_by ? sb.from('profiles').select('staff:staff_id(full_name)').eq('user_id', p.approved_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const client = p.clients ?? {};
  const prop = p.properties ?? {};
  const data: PdfData = {
    logoPath: path.join(process.cwd(), 'public', 'brand', 'wink-logo.png'),
    code: p.code,
    title: p.title,
    statusLabel: STATUS_LABEL[p.status] ?? p.status,
    generatedAt: formatDateEs(new Date()),
    client: { name: client.full_name ?? null, email: client.email ?? null, phone: client.phone ?? null },
    property: {
      address: prop.address ?? null,
      surface: prop.surface_m2 ? `${String(prop.surface_m2).replace('.', ',')} m²` : null,
      floor: prop.floor ?? null,
      year: prop.building_year ? String(prop.building_year) : null,
      cadastral: prop.cadastral_ref ?? null,
    },
    origin: ORIGIN_LABEL[p.origin] ?? p.origin,
    responsible: p.responsible?.full_name ?? null,
    documents: (docs.data ?? []).map((d) => ({ name: d.new_name ?? d.original_name, type: DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type, status: DOC_STATUS_LABEL[d.status] ?? d.status, description: d.description })),
    briefingMd: p.briefing_md,
    inconsistencies: (inc.data ?? []).map((i) => i.description),
    pending: (pend.data ?? []).map((x) => ({ description: x.description, status: PENDING_STATUS_LABEL[x.status] ?? x.status })),
    scopeMd: p.scope_md,
    checklist: (p.checklist?.sections ?? []) as PdfData['checklist'],
    visit: {
      confirmed: p.visit_at ? formatDateEs(p.visit_at) : null,
      proposed: (slots.data ?? []).filter((s) => s.status === 'propuesto').map((s) => formatDateEs(s.starts_at)),
    },
    approvedBy: (approver.data?.staff as unknown as { full_name: string } | null)?.full_name ?? null,
  };
  const buf = await renderToBuffer(<ExpedientePdf d={data} />);
  await audit('pdf_exportado', { projectId: id, actorType: 'usuario', actorId: user.id });
  return new NextResponse(new Uint8Array(buf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${p.code}_expediente_inicial.pdf"` },
  });
}
