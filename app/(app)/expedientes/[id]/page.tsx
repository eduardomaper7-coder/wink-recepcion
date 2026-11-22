import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { RealtimeRefresh } from '@/components/Realtime';
import { ExpedienteView, type ExpedienteData } from './view';
import { whatsappConversationUrl } from '@/integrations/whatsapp';
import { loadSettings } from '@/core/settings';

export const dynamic = 'force-dynamic';

export default async function ExpedientePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: project } = await sb
    .from('projects')
    .select('*, clients(*), properties(*), responsible:responsible_staff_id(id,full_name,email), origin_staff:origin_staff_id(full_name,email)')
    .eq('id', id)
    .single();
  if (!project) notFound();

  const [docs, pending, inc, slots, drafts, emails, events, staff, facts, steps] = await Promise.all([
    sb.from('documents').select('*').eq('project_id', id).order('folder').order('created_at'),
    sb.from('pending_items').select('*').eq('project_id', id).order('sort').order('created_at'),
    sb.from('inconsistencies').select('*').eq('project_id', id).order('created_at'),
    sb.from('visit_slots').select('*').eq('project_id', id).order('starts_at'),
    sb.from('email_drafts').select('*').eq('project_id', id).in('status', ['borrador', 'error']).order('created_at', { ascending: false }),
    sb.from('emails').select('id,direction,from_email,from_name,from_phone,channel,to_emails,cc_emails,subject,body_text,sent_at,created_at,sender_type,classification,approved_by').eq('project_id', id).order('created_at'),
    sb.from('events').select('id,actor_type,action,payload,created_at').eq('project_id', id).order('created_at', { ascending: false }).limit(60),
    sb.from('staff').select('id,full_name,email,role').eq('active', true).order('full_name'),
    sb.from('facts').select('field,value,source_label,is_internal').eq('project_id', id).order('created_at'),
    sb.from('agent_steps').select('step,task_no,label,email_id,status,detail,model,input_tokens,output_tokens,started_at,finished_at').eq('project_id', id).order('started_at'),
  ]);

  const data = {
    project,
    docs: docs.data ?? [],
    pending: pending.data ?? [],
    inconsistencies: inc.data ?? [],
    slots: slots.data ?? [],
    drafts: drafts.data ?? [],
    emails: emails.data ?? [],
    events: events.data ?? [],
    staff: staff.data ?? [],
    facts: facts.data ?? [],
    steps: steps.data ?? [],
    wa: {
      url: whatsappConversationUrl(project.wa_conversation_id ?? null),
      defaultMode: (await loadSettings()).wa_reply_modes.cliente_con_expediente,
    },
  } as unknown as ExpedienteData;

  return (
    <>
      <RealtimeRefresh channel={`p-${id}`} tables={['projects', 'documents', 'pending_items', 'email_drafts', 'emails', 'agent_steps']} />
      <ExpedienteView data={data} currentUserId={user.id} />
    </>
  );
}
