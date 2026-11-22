/**
 * Barra de progreso del agente a partir de sus pasos (agent_steps).
 * Componente de presentación: se re-renderiza con cada cambio en tiempo real y la anchura se anima por CSS.
 */
export interface StepLite {
  step: string;
  task_no: number;
  label: string;
  status: string; // pendiente | en_curso | ok | error | omitido
}

export function progressOf(steps: StepLite[]): { pct: number; current: StepLite | null; failed: boolean; done: boolean } {
  if (!steps.length) return { pct: 3, current: null, failed: false, done: false };
  const total = steps.length;
  const finished = steps.filter((s) => s.status === 'ok' || s.status === 'omitido').length;
  const running = steps.filter((s) => s.status === 'en_curso').length;
  const failed = steps.some((s) => s.status === 'error');
  const pct = Math.max(3, Math.min(100, Math.round(((finished + running * 0.5) / total) * 100)));
  const ordered = steps.slice().sort((a, b) => a.task_no - b.task_no);
  const current = ordered.find((s) => s.status === 'error') ?? ordered.find((s) => s.status === 'en_curso') ?? ordered.find((s) => s.status === 'pendiente') ?? null;
  return { pct, current, failed, done: finished === total };
}

export function AgentProgress({ steps, compact = false }: { steps: StepLite[]; compact?: boolean }) {
  const { pct, current, failed, done } = progressOf(steps);
  const label = failed
    ? `Error en «${current?.label}» · reintentando`
    : done
      ? 'Terminado'
      : current
        ? `${current.task_no > 0 && current.task_no <= 6 ? `Tarea ${current.task_no} · ` : ''}${current.label}…`
        : 'En cola…';
  return (
    <div className={compact ? 'mt-3' : 'mt-4'} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progreso del agente">
      <div className={`flex items-center justify-between ${compact ? 'text-[11px]' : 'text-xs'} mb-1`}>
        <span className={failed ? 'text-warn' : 'text-info'}>{label}</span>
        <span className="font-mono tabular-nums text-stone">{pct}%</span>
      </div>
      <div className={`w-full overflow-hidden bg-sand ${compact ? 'h-1.5' : 'h-2'}`}>
        <div
          className={`relative h-full transition-[width] duration-700 ease-out ${failed ? 'bg-warn' : 'bg-ink'}`}
          style={{ width: `${pct}%` }}
        >
          {!done && !failed ? <span className="absolute inset-0 animate-pulse bg-white/25" /> : null}
        </div>
      </div>
    </div>
  );
}
