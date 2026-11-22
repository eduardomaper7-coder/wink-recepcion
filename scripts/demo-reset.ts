/**
 * Reinicia el entorno de demo: borra expedientes, correos, documentos, cola y auditoría,
 * y pone a cero la numeración. Conserva personal, usuarios, plantillas y ajustes.
 *   npm run demo:reset -- --yes            (el buzón IMAP no se vuelve a leer desde el principio)
 *   npm run demo:reset -- --yes --mailbox  (además reinicia la marca de lectura del buzón)
 * Solo funciona con DEMO_MODE=true. NUNCA ejecutarlo contra producción.
 */
import './_env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { removePrefix } from '@/storage/storage';

async function main() {
  if (process.env.DEMO_MODE !== 'true') throw new Error('Bloqueado: DEMO_MODE no es "true"');
  if (!process.argv.includes('--yes')) throw new Error('Añade --yes para confirmar el borrado de los datos de demo');
  const sb = supabaseAdmin();
  const del = async (t: string) => {
    const { error } = await sb.from(t).delete().not('id', 'is', null);
    if (error) throw new Error(`${t}: ${error.message}`);
  };
  await sb.from('projects').update({ merged_into_id: null }).not('id', 'is', null);
  for (const t of ['agent_steps', 'email_drafts', 'facts', 'inconsistencies', 'pending_items', 'visit_slots', 'documents', 'email_attachments', 'jobs']) await del(t);
  await sb.from('events').delete().gte('id', 0);
  await sb.from('emails').update({ thread_id: null, project_id: null }).not('id', 'is', null);
  for (const t of ['email_threads', 'emails', 'projects', 'clients', 'properties']) await del(t);
  await sb.from('project_code_counters').delete().gte('year', 0);
  if (process.argv.includes('--mailbox')) await sb.from('mailbox_state').delete().neq('mailbox', '');
  await removePrefix('');
  console.log('✓ Demo reiniciada: 0 expedientes, numeración a cero, almacenamiento vacío.');
}
main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
