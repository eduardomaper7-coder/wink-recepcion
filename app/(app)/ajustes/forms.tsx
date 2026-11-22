'use client';
import { useState, useTransition } from 'react';
import * as A from './actions';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;

function useRun() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, t: r.ok ? (r.message ?? 'Guardado') : (r.error ?? 'Error') });
      setTimeout(() => setMsg(null), 4000);
    });
  return { pending, msg, run };
}

const input = 'w-full border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-ink';
const Section = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <section className="mb-8 border border-line bg-paper p-5">
    <h2 className="text-sm font-semibold uppercase tracking-[0.15em]">{title}</h2>
    {desc ? <p className="mb-4 mt-1 text-xs text-stone">{desc}</p> : <div className="mb-4" />}
    {children}
  </section>
);
const Msg = ({ m }: { m: { ok: boolean; t: string } | null }) => (m ? <span className={`text-sm ${m.ok ? 'text-ok' : 'text-warn'}`}>{m.t}</span> : null);

function General({ s }: { s: Any }) {
  const [v, setV] = useState({
    project_code_format: s.project_code_format,
    internal_domains: (s.internal_domains ?? []).join(', '),
    reminder_days: s.reminder_days,
    reminder_auto_after_first: s.reminder_auto_after_first,
    visit_duration_min: s.visit_duration_min,
    visit_start: s.visit_hours?.start ?? '09:30',
    visit_end: s.visit_hours?.end ?? '18:00',
    auto_send_internal: s.auto_send_internal,
    duplicate_window_days: s.duplicate_window_days,
    wink_signature: s.wink_signature,
    wa_reply_modes: { cliente_nuevo: 'asistente', cliente_con_expediente: 'borrador', personal: 'solo_recibir', ...(s.wa_reply_modes ?? {}) },
  });
  const { pending, msg, run } = useRun();
  const set = (k: string, val: unknown) => setV({ ...v, [k]: val });
  return (
    <Section title="Agente" desc={`Buzón del agente: ${s.agent_mailbox}`}>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm">Formato del código<input className={input} value={v.project_code_format} onChange={(e) => set('project_code_format', e.target.value)} /></label>
        <label className="text-sm md:col-span-2">Dominios internos (remitentes de Wink)<input className={input} value={v.internal_domains} onChange={(e) => set('internal_domains', e.target.value)} /></label>
        <label className="text-sm">Recordatorio a los (días)<input type="number" className={input} value={v.reminder_days} onChange={(e) => set('reminder_days', +e.target.value)} /></label>
        <label className="text-sm">Duración de la visita (min)<input type="number" className={input} value={v.visit_duration_min} onChange={(e) => set('visit_duration_min', +e.target.value)} /></label>
        <label className="text-sm">Ventana de duplicados (días)<input type="number" className={input} value={v.duplicate_window_days} onChange={(e) => set('duplicate_window_days', +e.target.value)} /></label>
        <label className="text-sm">Visitas desde<input type="time" className={input} value={v.visit_start} onChange={(e) => set('visit_start', e.target.value)} /></label>
        <label className="text-sm">Visitas hasta<input type="time" className={input} value={v.visit_end} onChange={(e) => set('visit_end', e.target.value)} /></label>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.auto_send_internal} onChange={(e) => set('auto_send_internal', e.target.checked)} /> Enviar solos los avisos internos</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.reminder_auto_after_first} onChange={(e) => set('reminder_auto_after_first', e.target.checked)} /> Recordatorios automáticos tras aprobar el primero</label>
        </div>
        <div className="border-t border-line pt-4 md:col-span-3">
          <p className="mb-2 text-sm font-semibold">WhatsApp · cómo se responde según quién escribe</p>
          <div className="grid gap-4 md:grid-cols-3">
            {([
              ['cliente_nuevo', 'Cliente nuevo (captación)'],
              ['cliente_con_expediente', 'Cliente con expediente'],
              ['personal', 'Personal de Wink'],
            ] as const).map(([k, label]) => (
              <label key={k} className="text-sm">
                {label}
                <select className={input} value={v.wa_reply_modes[k]} onChange={(e) => set('wa_reply_modes', { ...v.wa_reply_modes, [k]: e.target.value })}>
                  <option value="asistente">Asistente automático</option>
                  <option value="borrador">Borrador con aprobación</option>
                  <option value="solo_recibir">Solo recibir</option>
                  <option value="solo_equipo">Solo equipo</option>
                </select>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone">
            Asistente automático: responde el asistente de WhatsApp (sin precios). Borrador con aprobación: el agente prepara la respuesta y la aprueba un arquitecto. Solo recibir: todo va al expediente sin responder. Solo equipo: contesta una persona desde la bandeja de WhatsApp. Cada expediente puede tener su propio modo.
          </p>
        </div>
        <label className="text-sm md:col-span-3">Firma de los correos<textarea className={`${input} h-24`} value={v.wink_signature} onChange={(e) => set('wink_signature', e.target.value)} /></label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" disabled={pending} onClick={() => run(() => A.saveSettings({ ...v, internal_domains: v.internal_domains.split(',').map((x: string) => x.trim()).filter(Boolean) }))} className="bg-ink px-4 py-1.5 text-sm text-cream">Guardar</button>
        <Msg m={msg} />
      </div>
    </Section>
  );
}

function StaffRow({ row }: { row: Any }) {
  const [v, setV] = useState({ id: row.id as string | undefined, full_name: row.full_name ?? '', email: row.email ?? '', phone: row.phone ?? '', role: row.role ?? '', active: row.active ?? true });
  const { pending, msg, run } = useRun();
  return (
    <div className="grid grid-cols-[1fr_1fr_150px_140px_80px_auto] items-center gap-2 py-1">
      <input className={input} placeholder="Nombre" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} />
      <input className={input} placeholder="Email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <input className={input} placeholder="Móvil (WhatsApp)" title="Para reconocerle cuando escriba por WhatsApp. Formato +34600111222" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <select className={input} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
        <option value="">Sin acceso</option>
        <option value="arquitecto">Arquitecto</option>
        <option value="admin">Administración</option>
      </select>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Activo</label>
      <span className="flex items-center gap-2">
        <button type="button" disabled={pending} className="text-sm underline" onClick={() => run(() => A.saveStaff(v))}>{v.id ? 'Guardar' : 'Añadir'}</button>
        <Msg m={msg} />
      </span>
    </div>
  );
}

function ReqDocRow({ row }: { row: Any }) {
  const [v, setV] = useState({ id: row.id as string | undefined, label: row.label ?? '', kind: row.kind ?? 'documento', match_rule: JSON.stringify(row.match_rule ?? { doc_type: 'otro' }), required: row.required ?? true, active: row.active ?? true, sort: row.sort ?? 999 });
  const { pending, msg, run } = useRun();
  return (
    <div className="grid grid-cols-[2fr_110px_2fr_70px_70px_60px_auto] items-center gap-2 py-1">
      <input className={input} value={v.label} placeholder="Descripción" onChange={(e) => setV({ ...v, label: e.target.value })} />
      <select className={input} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
        <option value="documento">Documento</option>
        <option value="dato">Dato</option>
      </select>
      <input className={`${input} font-mono text-xs`} value={v.match_rule} onChange={(e) => setV({ ...v, match_rule: e.target.value })} />
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={v.required} onChange={(e) => setV({ ...v, required: e.target.checked })} /> Oblig.</label>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Activo</label>
      <input type="number" className={input} value={v.sort} onChange={(e) => setV({ ...v, sort: +e.target.value })} />
      <span className="flex items-center gap-2">
        <button type="button" disabled={pending} className="text-sm underline" onClick={() => run(() => A.saveRequiredDoc(v))}>{v.id ? 'Guardar' : 'Añadir'}</button>
        <Msg m={msg} />
      </span>
    </div>
  );
}

function ChecklistRow({ row }: { row: Any }) {
  const [v, setV] = useState({ id: row.id as string | undefined, name: row.name ?? '', section: row.section ?? '', conditions: JSON.stringify(row.conditions ?? {}), items: (row.items ?? []).join('\n'), active: row.active ?? true, sort: row.sort ?? 999 });
  const { pending, msg, run } = useRun();
  return (
    <div className="grid gap-2 border-b border-line py-3 md:grid-cols-[1fr_2fr]">
      <div className="space-y-2">
        <input className={input} value={v.name} placeholder="Nombre de la plantilla" onChange={(e) => setV({ ...v, name: e.target.value })} />
        <input className={input} value={v.section} placeholder="Sección del checklist" onChange={(e) => setV({ ...v, section: e.target.value })} />
        <input className={`${input} font-mono text-xs`} value={v.conditions} title='{"building_year_max":1959} · {"rooms_any":["cocina"]} · {}' onChange={(e) => setV({ ...v, conditions: e.target.value })} />
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Activa</label>
          <label className="flex items-center gap-1">Orden <input type="number" className="w-16 border border-line px-1" value={v.sort} onChange={(e) => setV({ ...v, sort: +e.target.value })} /></label>
          <button type="button" disabled={pending} className="text-sm underline" onClick={() => run(() => A.saveChecklistTemplate(v))}>{v.id ? 'Guardar' : 'Añadir'}</button>
          <Msg m={msg} />
        </div>
      </div>
      <textarea className={`${input} h-32`} value={v.items} placeholder="Una comprobación por línea" onChange={(e) => setV({ ...v, items: e.target.value })} />
    </div>
  );
}

function NewUser({ staff }: { staff: Any[] }) {
  const [v, setV] = useState({ email: '', password: '', role: 'arquitecto', staff_id: '' });
  const { pending, msg, run } = useRun();
  return (
    <div className="grid grid-cols-[1fr_1fr_140px_1fr_auto] items-center gap-2">
      <input className={input} placeholder="Email de acceso" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
      <input className={input} type="password" placeholder="Contraseña (mín. 10)" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
      <select className={input} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
        <option value="arquitecto">Arquitecto</option>
        <option value="admin">Administración</option>
      </select>
      <select className={input} value={v.staff_id} onChange={(e) => setV({ ...v, staff_id: e.target.value })}>
        <option value="">Ficha de personal…</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
      <span className="flex items-center gap-2">
        <button type="button" disabled={pending} className="text-sm underline" onClick={() => run(() => A.createAppUser({ ...v, staff_id: v.staff_id || null }))}>Crear</button>
        <Msg m={msg} />
      </span>
    </div>
  );
}

export function SettingsForms({ settings, staff, reqDocs, checklist, usersCount }: { settings: Any | null; staff: Any[]; reqDocs: Any[]; checklist: Any[]; usersCount: number }) {
  return (
    <div>
      {settings ? <General s={settings} /> : null}
      <Section title="Personal de Wink" desc="Sirve para reconocer remitentes internos (por email o por su móvil en WhatsApp) y asignar responsables. 'Sin acceso' = solo remitente.">
        {staff.map((s) => <StaffRow key={s.id} row={s} />)}
        <StaffRow row={{}} />
      </Section>
      <Section title="Usuarios de la aplicación" desc={`${usersCount} usuario(s) con acceso. Crea aquí el acceso de arquitectos y administración.`}>
        <NewUser staff={staff} />
      </Section>
      <Section title="Documentación e información necesaria · Reforma integral" desc='Reglas: {"doc_type":"nota_simple"} · {"doc_type":"foto","min":4} · {"doc_type":"certificado","subtype":"eficiencia_energetica"} · {"doc_type":"plano","flag":"es_estado_actual_completo"} · {"fact":"client.phone"}'>
        {reqDocs.map((r) => <ReqDocRow key={r.id} row={r} />)}
        <ReqDocRow row={{}} />
      </Section>
      <Section title="Plantillas del checklist de visita" desc='Condiciones: {} (siempre) · {"building_year_max":1959} · {"building_year_min":1960,"building_year_max":1980} · {"rooms_any":["cocina"]} · {"typology":["piso"]}'>
        {checklist.map((c) => <ChecklistRow key={c.id} row={c} />)}
        <ChecklistRow row={{}} />
      </Section>
    </div>
  );
}
