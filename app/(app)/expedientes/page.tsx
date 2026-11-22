import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { RealtimeRefresh } from '@/components/Realtime';
import { BOARD_COLUMNS, ORIGIN_LABEL, STATUS_LABEL } from '@/core/labels';
import { AgentProgress, type StepLite } from '@/components/AgentProgress';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  code: string;
  title: string | null;
  status: string;
  origin: string;
  received_at: string;
  responsible_staff_id: string | null;
  clients: { full_name: string | null } | null;
  properties: { address: string | null } | null;
  responsible: { full_name: string } | null;
  pending_items: { status: string; audience: string }[];
  inconsistencies: { resolved_at: string | null }[];
}

export default async function ExpedientesPage({ searchParams }: { searchParams: Promise<{ mios?: string }> }) {
  const user = await requirePageUser();
  const { mios } = await searchParams;
  const onlyMine = mios === '1';
  const sb = await supabaseServer();
  let q = sb
    .from('projects')
    .select('id,code,title,status,origin,received_at,responsible_staff_id,clients(full_name),properties(address),responsible:responsible_staff_id(full_name),pending_items(status,audience),inconsistencies(resolved_at)')
    .is('merged_into_id', null)
    .neq('status', 'archivado')
    .order('received_at', { ascending: false })
    .limit(200);
  if (onlyMine && user.staffId) q = q.eq('responsible_staff_id', user.staffId);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];

  // Correos que el agente está procesando ahora (aún sin expediente o con el expediente en "procesando")
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: inFlight } = await sb
    .from('emails')
    .select('id,from_name,from_email,subject,created_at,project_id,agent_steps(step,task_no,label,status)')
    .eq('direction', 'entrante')
    .in('processing_status', ['recibido', 'procesando', 'error'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);
  const processing = (inFlight ?? []) as unknown as { id: string; from_name: string | null; from_email: string; subject: string | null; created_at: string; project_id: string | null; agent_steps: StepLite[] }[];
  const stepsByProject = new Map(processing.filter((p) => p.project_id).map((p) => [p.project_id as string, p.agent_steps]));

  return (
    <div>
      <RealtimeRefresh channel="board" tables={['projects', 'pending_items', 'agent_steps', 'emails']} />
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Expedientes</h1>
          <p className="text-sm text-stone">Actualización en tiempo real · {rows.length} expediente(s)</p>
        </div>
        <div className="flex border border-line text-sm">
          <Link href="/expedientes" className={`px-3 py-1.5 ${!onlyMine ? 'bg-ink text-cream' : ''}`}>
            Todos
          </Link>
          <Link href="/expedientes?mios=1" className={`px-3 py-1.5 ${onlyMine ? 'bg-ink text-cream' : ''}`}>
            Asignados a mí
          </Link>
        </div>
      </div>
      {onlyMine && !user.staffId ? <p className="mb-4 text-sm text-warn">Tu usuario no está vinculado a una ficha de personal.</p> : null}

      {processing.length ? (
        <section className="mb-8 border border-info/30 bg-paper p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider">
            Procesando ahora <span className="font-normal text-stone">· {processing.length}</span>
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {processing.map((m) => {
              const body = (
                <>
                  <div className="flex items-center justify-between gap-3 text-xs text-stone">
                    <span className="truncate">{m.from_name ?? m.from_email}</span>
                    <span className="shrink-0">{new Date(m.created_at).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="truncate text-sm font-medium">{m.subject || '(sin asunto)'}</p>
                  <AgentProgress steps={m.agent_steps} />
                </>
              );
              return m.project_id ? (
                <Link key={m.id} href={`/expedientes/${m.project_id}`} className="animate-pop block border border-line p-3 hover:border-ink">
                  {body}
                </Link>
              ) : (
                <div key={m.id} className="animate-pop border border-line p-3">
                  {body}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        {BOARD_COLUMNS.map((col) => {
          const items = rows.filter((r) => (col.statuses as readonly string[]).includes(r.status));
          return (
            <section key={col.key} className="min-h-[300px]">
              <h2 className="mb-3 flex items-center justify-between border-b border-ink pb-2 text-sm font-semibold uppercase tracking-wider">
                {col.label}
                <span className="font-normal text-stone">{items.length}</span>
              </h2>
              <div className="space-y-3">
                {items.map((r) => {
                  const open = r.pending_items.filter((p) => ['pendiente', 'pedido'].includes(p.status) && p.audience === 'cliente').length;
                  const inc = r.inconsistencies.filter((i) => !i.resolved_at).length;
                  return (
                    <Link key={r.id} href={`/expedientes/${r.id}`} className="animate-pop block border border-line bg-paper p-4 transition hover:border-ink">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold">{r.code}</span>
                        <span className={r.status === 'procesando' ? 'animate-pulse text-info' : r.status === 'esperando_datos_internos' ? 'text-warn' : 'text-stone'}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </div>
                      <p className="font-medium leading-snug">{r.clients?.full_name ?? 'Cliente sin identificar'}</p>
                      <p className="line-clamp-2 text-sm text-ink/70">{r.title ?? r.properties?.address ?? '—'}</p>
                      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-stone">
                        <span>{ORIGIN_LABEL[r.origin]}</span>
                        <span>· {r.responsible?.full_name ?? 'Sin asignar'}</span>
                        {open ? <span className="text-warn">· {open} pendiente(s)</span> : null}
                        {inc ? <span className="text-warn">· {inc} incoherencia(s)</span> : null}
                      </div>
                      {r.status === 'procesando' && stepsByProject.get(r.id) ? <AgentProgress steps={stepsByProject.get(r.id)!} compact /> : null}
                    </Link>
                  );
                })}
                {!items.length ? <p className="text-sm text-stone">Nada por aquí.</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
