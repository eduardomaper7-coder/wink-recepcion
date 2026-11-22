import { requirePageUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SettingsForms } from './forms';

export const dynamic = 'force-dynamic';

export default async function AjustesPage() {
  await requirePageUser({ admin: true });
  const sb = supabaseAdmin();
  const [settings, staff, reqDocs, checklist, profiles] = await Promise.all([
    sb.from('settings').select('*').single(),
    sb.from('staff').select('*').order('full_name'),
    sb.from('required_docs_templates').select('*').order('sort'),
    sb.from('checklist_templates').select('*').order('sort'),
    sb.from('profiles').select('user_id,role,staff_id'),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-semibold">Ajustes</h1>
      <p className="mb-6 text-sm text-stone">Configuración del agente, personal de Wink y plantillas. Solo administradores.</p>
      <SettingsForms
        settings={settings.data}
        staff={staff.data ?? []}
        reqDocs={reqDocs.data ?? []}
        checklist={checklist.data ?? []}
        usersCount={profiles.data?.length ?? 0}
      />
    </div>
  );
}
