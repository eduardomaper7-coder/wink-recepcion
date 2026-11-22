/**
 * Recordatorio automático al cliente si los pendientes siguen sin llegar tras X días.
 * El primero de cada expediente SIEMPRE requiere aprobación; los siguientes salen solos
 * solo si settings.reminder_auto_after_first está activo y ya se aprobó uno antes.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadSettings } from '@/core/settings';
import { reminderEmail, saveDraft } from './drafts';
import { sendDraft } from './send';
import { audit } from '@/core/audit';

export async function createDueReminders(now = new Date()): Promise<{ drafted: number; sent: number }> {
  const sb = supabaseAdmin();
  const s = await loadSettings();
  const cutoff = new Date(now.getTime() - s.reminder_days * 86_400_000).toISOString();
  const { data: projects } = await sb.from('projects').select('id,code,client_id,responsible_staff_id').eq('status', 'esperando_cliente');
  let drafted = 0;
  let sent = 0;
  for (const p of projects ?? []) {
    const { data: open } = await sb.from('pending_items').select('description,requested_at,last_reminder_at').eq('project_id', p.id).eq('status', 'pedido').eq('audience', 'cliente');
    if (!open?.length) continue;
    const lastContact = open.map((o) => o.last_reminder_at ?? o.requested_at).filter(Boolean).sort().pop();
    if (!lastContact || lastContact > cutoff) continue;
    const { data: openDraft } = await sb.from('email_drafts').select('id').eq('project_id', p.id).eq('kind', 'recordatorio').eq('status', 'borrador').maybeSingle();
    if (openDraft) continue;

    const { data: client } = await sb.from('clients').select('full_name,email').eq('id', p.client_id).single();
    if (!client?.email) continue;
    const { data: resp } = p.responsible_staff_id ? await sb.from('staff').select('email').eq('id', p.responsible_staff_id).single() : { data: null };
    const { count: prevApproved } = await sb.from('email_drafts').select('id', { count: 'exact', head: true }).eq('project_id', p.id).eq('kind', 'recordatorio').eq('status', 'enviado');
    const auto = s.reminder_auto_after_first && (prevApproved ?? 0) > 0;

    const draftId = await saveDraft({
      projectId: p.id,
      kind: 'recordatorio',
      to: [client.email],
      cc: resp?.email ? [resp.email] : [],
      subject: `Recordatorio: documentación pendiente (${p.code})`,
      body: reminderEmail({ clientName: client.full_name, items: open.map((o) => o.description), signature: s.wink_signature }),
      requiresApproval: !auto,
    });
    drafted++;
    if (auto) {
      await sendDraft(draftId, null);
      sent++;
    }
    await audit('recordatorio_preparado', { projectId: p.id, payload: { automatico: auto } });
  }
  return { drafted, sent };
}
