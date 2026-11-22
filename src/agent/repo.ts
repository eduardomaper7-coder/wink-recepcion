/** Lecturas agrupadas del expediente para el agente. */
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { FactRow } from './facts';
import type { ReceivedDoc } from './pending';

export interface ProjectBundle {
  project: {
    id: string;
    code: string;
    status: string;
    origin: 'cliente_directo' | 'reenvio_personal' | 'encargo_personal' | 'cc_personal' | 'whatsapp';
    internal_context: string | null;
    responsible_staff_id: string | null;
    origin_staff_id: string | null;
    client_id: string | null;
    property_id: string | null;
    project_type_id: string | null;
    title: string | null;
    visit_at: string | null;
    wa_conversation_id: string | null;
    wa_reply_mode: string | null;
  };
  client: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  property: { id: string; address: string | null; building_year: number | null; typology: string | null; surface_m2: number | null } | null;
  responsible: { id: string; full_name: string; email: string } | null;
  facts: FactRow[];
  docs: (ReceivedDoc & { new_name: string | null; original_name: string; description: string | null; folder: string })[];
}

export async function loadBundle(projectId: string): Promise<ProjectBundle> {
  const sb = supabaseAdmin();
  const { data: project, error } = await sb.from('projects').select('*').eq('id', projectId).single();
  if (error || !project) throw new Error(`Expediente ${projectId} no encontrado`);
  const [client, property, responsible, facts, docs] = await Promise.all([
    project.client_id ? sb.from('clients').select('id,full_name,email,phone').eq('id', project.client_id).single() : Promise.resolve({ data: null }),
    project.property_id ? sb.from('properties').select('id,address,building_year,typology,surface_m2').eq('id', project.property_id).single() : Promise.resolve({ data: null }),
    project.responsible_staff_id ? sb.from('staff').select('id,full_name,email').eq('id', project.responsible_staff_id).single() : Promise.resolve({ data: null }),
    sb.from('facts').select('id,field,value,value_num,source_type,source_label,is_internal').eq('project_id', projectId).order('created_at'),
    sb.from('documents').select('id,doc_type,status,extracted,new_name,original_name,description,folder').eq('project_id', projectId).order('created_at'),
  ]);
  return {
    project,
    client: client.data,
    property: property.data,
    responsible: responsible.data,
    facts: (facts.data ?? []) as FactRow[],
    docs: (docs.data ?? []) as ProjectBundle['docs'],
  };
}

/** Actualiza cliente e inmueble con el mejor valor conocido de cada dato. */
export async function syncEntitiesFromFacts(b: ProjectBundle) {
  const { bestValue } = await import('./facts');
  const { normalizeAddress, normalizePhone, normalizeEmail, parseSpanishNumber } = await import('@/lib/text');
  const sb = supabaseAdmin();
  const v = (f: string) => bestValue(b.facts, f)?.value ?? null;
  if (b.property) {
    const year = parseSpanishNumber(v('property.building_year'));
    await sb
      .from('properties')
      .update({
        address: v('property.address') ?? b.property.address,
        address_norm: normalizeAddress(v('property.address') ?? b.property.address),
        postal_code: v('property.postal_code'),
        city: v('property.city'),
        cadastral_ref: v('property.cadastral_ref'),
        registry_finca: v('property.registry_finca'),
        surface_m2: parseSpanishNumber(v('property.surface_m2')),
        floor: v('property.floor'),
        typology: v('property.typology'),
        building_year: year ? Math.round(year) : null,
      })
      .eq('id', b.property.id);
  }
  if (b.client) {
    const phone = normalizePhone(v('client.phone')) ?? v('client.phone');
    const email = normalizeEmail(v('client.email'));
    await sb
      .from('clients')
      .update({
        full_name: b.client.full_name ?? v('client.name'),
        phone: b.client.phone ?? phone,
        ...(b.client.email ? {} : email ? { email } : {}),
      })
      .eq('id', b.client.id);
  }
}
