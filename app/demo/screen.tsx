'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

interface Step {
  step: string;
  task_no: number;
  label: string;
  status: string;
  detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  project_id: string | null;
}
interface MailInfo {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  created_at: string;
  classification: string;
  processing_status: string;
  attachments: number;
}
interface ProjectInfo {
  id: string;
  code: string;
  title: string | null;
  status: string;
}

const TASKS = [
  { n: 1, title: 'Crear el expediente', out: 'Expediente digital' },
  { n: 2, title: 'Revisar la información', out: 'Inventario documental' },
  { n: 3, title: 'Entender el proyecto', out: 'Briefing técnico' },
  { n: 4, title: 'Detectar lo que falta', out: 'Listado de pendientes' },
  { n: 5, title: 'Definir el alcance', out: 'Alcance preliminar' },
  { n: 6, title: 'Preparar la visita', out: 'Checklist y planificación' },
];

export function DemoScreen({ cases, demoMode, mailbox }: { cases: { key: string; label: string }[]; demoMode: boolean; mailbox: string }) {
  const sb = supabaseBrowser();
  const [emailId, setEmailId] = useState<string | null>(null);
  const [mail, setMail] = useState<MailInfo | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const emailRef = useRef<string | null>(null);

  const load = useCallback(
    async (id: string) => {
      const [{ data: m }, { data: st }, { count }] = await Promise.all([
        sb.from('emails').select('id,from_email,from_name,subject,created_at,classification,processing_status').eq('id', id).single(),
        sb.from('agent_steps').select('step,task_no,label,status,detail,started_at,finished_at,project_id').eq('email_id', id).order('task_no'),
        sb.from('email_attachments').select('id', { count: 'exact', head: true }).eq('email_id', id),
      ]);
      if (m) setMail({ ...m, attachments: count ?? 0 });
      setSteps(st ?? []);
      const pid = (st as Step[] | null)?.find((s: Step) => s.project_id)?.project_id;
      if (pid) {
        const { data: p } = await sb.from('projects').select('id,code,title,status').eq('id', pid).single();
        setProject(p);
      } else setProject(null);
    },
    [sb],
  );

  // Último correo entrante al abrir la pantalla
  useEffect(() => {
    sb.from('emails')
      .select('id')
      .eq('direction', 'entrante')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: { id: string } | null }) => {
        if (data) {
          emailRef.current = data.id;
          setEmailId(data.id);
          load(data.id);
        }
      });
  }, [sb, load]);

  // Tiempo real: nuevos correos y avance de los pasos
  useEffect(() => {
    const ch = sb
      .channel('demo')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'emails' }, (p: { new: unknown }) => {
        const row = p.new as { id: string; direction: string };
        if (row.direction !== 'entrante') return;
        emailRef.current = row.id;
        setEmailId(row.id);
        setSteps([]);
        setProject(null);
        load(row.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_steps' }, (p: { new: unknown }) => {
        const row = p.new as { email_id?: string };
        if (row.email_id && row.email_id === emailRef.current) load(row.email_id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'projects' }, (p: { new: unknown }) => {
        const row = p.new as ProjectInfo;
        setProject((cur) => (cur && cur.id === row.id ? { ...cur, status: row.status, title: row.title } : cur));
      })
      .subscribe();
    return () => {
      sb.removeChannel(ch);
    };
  }, [sb, load]);

  // Cronómetro
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  // Escucha del buzón real cada 5 s mientras está activada
  useEffect(() => {
    if (!listening) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'poll' }) });
        const j = await r.json();
        if (!r.ok) setNote(j.error ?? 'No se pudo leer el buzón');
        else if (j.ingested) setNote(`📩 ${j.ingested} correo(s) nuevo(s)`);
      } catch {
        setNote('No se pudo leer el buzón');
      }
      if (!stop) setTimeout(tick, 5000);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [listening]);

  const inject = async (key: string) => {
    setNote('Enviando caso…');
    const r = await fetch('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'inject', case: key }) });
    const j = await r.json();
    setNote(r.ok ? null : (j.error ?? 'Error'));
  };

  const byTask = (n: number) => steps.filter((s) => s.task_no === n);
  const t0 = mail ? new Date(mail.created_at).getTime() : null;
  const allDone = steps.length > 0 && steps.every((s) => ['ok', 'omitido', 'error'].includes(s.status));
  const lastFinish = steps.map((s) => (s.finished_at ? new Date(s.finished_at).getTime() : 0)).reduce((a, b) => Math.max(a, b), 0);
  const elapsed = t0 ? ((allDone ? lastFinish : now) - t0) / 1000 : 0;
  const recep = steps.find((s) => s.step === 't0_recepcion');
  const ignored = mail?.processing_status === 'ignorado';

  return (
    <div className="min-h-screen bg-ink text-cream">
      <header className="flex items-center justify-between px-10 py-6">
        <div className="flex items-center gap-5">
          <Image src="/brand/wink-logo-white.png" alt="Wink" width={110} height={35} priority />
          <span className="text-xs uppercase tracking-[0.3em] text-cream/50">Agente de recepción del encargo</span>
        </div>
        <div className="text-right">
          <p className={`font-mono text-5xl tabular-nums ${allDone && elapsed < 60 ? 'text-[#9fd0ae]' : ''}`}>{elapsed ? `${elapsed.toFixed(1)} s` : '0.0 s'}</p>
          <p className="text-xs text-cream/50">desde la recepción del correo</p>
        </div>
      </header>

      <div className="grid gap-8 px-10 pb-10 lg:grid-cols-[360px_1fr]">
        {/* Correo recibido */}
        <aside className="space-y-6">
          <div className="border border-cream/15 p-5">
            <p className="mb-3 text-xs uppercase tracking-[0.25em] text-cream/50">Correo recibido</p>
            {mail ? (
              <div className="animate-pop" key={mail.id}>
                <p className="text-lg font-medium leading-snug">{mail.subject || '(sin asunto)'}</p>
                <p className="mt-1 text-sm text-cream/70">{mail.from_name ?? mail.from_email}</p>
                <p className="mt-3 text-sm text-cream/60">📎 {mail.attachments} adjunto(s)</p>
                {recep?.detail ? <p className="mt-3 border-l-2 border-cream/40 pl-3 text-sm">{recep.detail}</p> : null}
                {ignored ? <p className="mt-3 text-sm text-[#f0b089]">Marcado como “no es encargo” → bandeja de revisión</p> : null}
              </div>
            ) : (
              <p className="text-sm text-cream/50">Esperando un correo en {mailbox}…</p>
            )}
          </div>

          {project ? (
            <div className="animate-pop border border-cream/15 p-5">
              <p className="mb-2 text-xs uppercase tracking-[0.25em] text-cream/50">Resultado</p>
              <p className="font-mono text-2xl">{project.code}</p>
              <p className="mt-1 text-sm text-cream/70">{project.title}</p>
              <p className="mt-3 inline-block border border-cream/40 px-2 py-0.5 text-xs uppercase tracking-wider">
                {project.status === 'pendiente_revision' ? 'Pendiente de revisión' : project.status.replaceAll('_', ' ')}
              </p>
              <Link href={`/expedientes/${project.id}`} className="mt-4 block text-sm underline underline-offset-4">
                Abrir el expediente →
              </Link>
            </div>
          ) : null}

          <div className="border border-cream/15 p-5 text-sm">
            <p className="mb-3 text-xs uppercase tracking-[0.25em] text-cream/50">Controles</p>
            <label className="mb-4 flex items-center gap-2">
              <input type="checkbox" checked={listening} onChange={(e) => setListening(e.target.checked)} />
              Escuchar el buzón {mailbox} (cada 5 s)
            </label>
            {demoMode ? (
              <div className="space-y-2">
                {cases.map((c) => (
                  <button key={c.key} type="button" onClick={() => inject(c.key)} className="block w-full border border-cream/20 px-3 py-2 text-left text-xs hover:border-cream">
                    {c.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-cream/50">Casos de ejemplo desactivados (DEMO_MODE=false).</p>
            )}
            {note ? <p className="mt-3 text-xs text-cream/70">{note}</p> : null}
            <Link href="/expedientes" className="mt-4 block text-xs text-cream/50 underline">
              Volver a la aplicación
            </Link>
          </div>
        </aside>

        {/* Las 6 tareas */}
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {TASKS.map((t) => {
            const ss = byTask(t.n);
            const status = !ss.length ? 'pendiente' : ss.some((s) => s.status === 'error') ? 'error' : ss.every((s) => s.status === 'ok') ? 'ok' : ss.some((s) => s.status === 'en_curso') ? 'en_curso' : ss.every((s) => s.status === 'omitido') ? 'omitido' : 'pendiente';
            const detail = ss.map((s) => s.detail).filter(Boolean).join(' · ');
            const secs = ss[0]?.started_at && ss.at(-1)?.finished_at ? (new Date(ss.at(-1)!.finished_at!).getTime() - new Date(ss[0].started_at!).getTime()) / 1000 : null;
            return (
              <div
                key={t.n}
                className={`relative min-h-[190px] border p-6 transition-all duration-500 ${
                  status === 'ok' ? 'border-cream bg-cream text-ink' : status === 'en_curso' ? 'border-cream/70 bg-cream/5' : status === 'error' ? 'border-[#f0b089]' : 'border-cream/15 text-cream/40'
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className="font-mono text-5xl font-light">{t.n}</span>
                  <span className="text-xs uppercase tracking-wider">
                    {status === 'ok' ? `✓ ${secs !== null ? `${secs.toFixed(1)} s` : ''}` : status === 'en_curso' ? <span className="animate-pulse">trabajando…</span> : status === 'error' ? 'error · reintentando' : status === 'omitido' ? 'no aplica' : ''}
                  </span>
                </div>
                <p className="mt-3 text-lg font-medium">{t.title}</p>
                <p className={`text-xs uppercase tracking-[0.2em] ${status === 'ok' ? 'text-stone' : ''}`}>→ {t.out}</p>
                {detail ? <p className="animate-pop mt-3 text-sm leading-snug">{detail}</p> : null}
              </div>
            );
          })}
          {allDone && project && !ignored ? (
            <div className="animate-pop border border-cream/30 p-6 md:col-span-2 xl:col-span-3">
              <p className="text-xs uppercase tracking-[0.25em] text-cream/50">Resultado global</p>
              <p className="mt-2 text-2xl">Expediente técnico inicial preparado para la visita del inmueble</p>
              <p className="mt-1 text-cream/70">
                {project.code} · estado “{project.status === 'pendiente_revision' ? 'Pendiente de revisión' : project.status.replaceAll('_', ' ')}” · {elapsed.toFixed(1)} s
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
