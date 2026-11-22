import { requirePageUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { RealtimeRefresh } from '@/components/Realtime';
import { InboxActions } from './inbox-actions';

export const dynamic = 'force-dynamic';

const REASON: Record<string, string> = {
  no_encargo: 'No es un encargo',
  auto_respuesta: 'Respuesta automática',
  respuesta: 'Respuesta sin expediente vinculado',
  confirmacion_visita: 'Confirmación sin expediente vinculado',
  sin_clasificar: 'Sin clasificar',
  encargo: 'Encargo',
};

export default async function BandejaPage() {
  await requirePageUser();
  const sb = await supabaseServer();
  const { data } = await sb
    .from('emails')
    .select('id,from_email,from_name,subject,body_text,created_at,classification,processing_status,processing_error,analysis')
    .eq('direction', 'entrante')
    .is('approved_by', null)
    .or('processing_status.eq.error,processing_status.eq.ignorado')
    .order('created_at', { ascending: false })
    .limit(100);
  const rows = data ?? [];
  return (
    <div>
      <RealtimeRefresh channel="inbox" tables={['emails']} />
      <h1 className="text-2xl font-semibold">Bandeja de revisión</h1>
      <p className="mb-6 text-sm text-stone">Correos que el agente no ha convertido en expediente: no son encargos, respuestas automáticas, respuestas sin hilo reconocible o errores de procesado.</p>
      <div className="divide-y divide-line border-y border-line bg-paper">
        {rows.map((m) => (
          <div key={m.id} className="grid grid-cols-[180px_1fr_auto] gap-4 px-4 py-3">
            <div className="text-xs">
              <p className={m.processing_status === 'error' ? 'font-semibold text-warn' : 'text-stone'}>{m.processing_status === 'error' ? 'Error de procesado' : REASON[m.classification] ?? m.classification}</p>
              <p className="text-stone">{new Date(m.created_at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{m.subject || '(sin asunto)'}</p>
              <p className="truncate text-xs text-stone">{m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}</p>
              <p className="mt-1 line-clamp-2 text-sm text-ink/70">{(m.analysis as { motivo?: string } | null)?.motivo ?? m.processing_error ?? m.body_text?.slice(0, 200)}</p>
            </div>
            <InboxActions emailId={m.id} />
          </div>
        ))}
        {!rows.length ? <p className="px-4 py-6 text-sm text-stone">Nada pendiente de revisar.</p> : null}
      </div>
    </div>
  );
}
