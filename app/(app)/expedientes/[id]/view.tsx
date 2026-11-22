'use client';
import { useState, useTransition } from 'react';
import { Markdown } from '@/components/Markdown';
import { AgentProgress } from '@/components/AgentProgress';
import { DOC_STATUS_LABEL, DOC_TYPE_LABEL, DRAFT_KIND_LABEL, ORIGIN_LABEL, PENDING_STATUS_LABEL, STATUS_LABEL } from '@/core/labels';
import * as A from './actions';

/* ------------------------------------------------------------------ tipos */
interface Doc {
  id: string;
  doc_type: string;
  original_name: string;
  new_name: string | null;
  folder: string;
  mime: string;
  status: string;
  description: string | null;
  extracted: Record<string, unknown>;
  classified_by: string;
  confidence: number | null;
}
interface Pending {
  id: string;
  description: string;
  status: string;
  source: string;
  audience: string;
}
interface Draft {
  id: string;
  kind: string;
  to_emails: string[];
  cc_emails: string[];
  subject: string;
  body_text: string;
  status: string;
  requires_approval: boolean;
  compliance_flags: string[];
  error: string | null;
  channel: 'email' | 'whatsapp';
}
interface Mail {
  id: string;
  direction: string;
  from_email: string;
  from_name: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body_text: string | null;
  sent_at: string | null;
  created_at: string;
  sender_type: string;
  approved_by: string | null;
  channel: 'email' | 'whatsapp';
  from_phone: string | null;
}
interface ChecklistSection {
  section: string;
  items: { text: string; reason: string | null; origin?: 'plantilla' | 'agente' | 'usuario'; done?: boolean }[];
}
export interface ExpedienteData {
  project: {
    id: string;
    code: string;
    title: string | null;
    status: string;
    origin: string;
    internal_context: string | null;
    briefing_md: string | null;
    scope_md: string | null;
    checklist: { sections: ChecklistSection[]; plantillas?: string[] } | null;
    visit_at: string | null;
    approved_at: string | null;
    received_at: string;
    clients: { full_name: string | null; email: string | null; phone: string | null } | null;
    properties: { address: string | null; surface_m2: number | null; floor: string | null; building_year: number | null; cadastral_ref: string | null; typology: string | null } | null;
    responsible: { id: string; full_name: string; email: string } | null;
    origin_staff: { full_name: string; email: string } | null;
    wa_conversation_id: string | null;
    wa_reply_mode: 'solo_recibir' | 'borrador' | 'asistente' | 'solo_equipo' | null;
  };
  docs: Doc[];
  pending: Pending[];
  inconsistencies: { id: string; description: string; resolved_at: string | null; origin: string }[];
  slots: { id: string; starts_at: string; ends_at: string; status: string }[];
  drafts: Draft[];
  emails: Mail[];
  events: { id: number; actor_type: string; action: string; payload: Record<string, unknown>; created_at: string }[];
  staff: { id: string; full_name: string; email: string; role: string | null }[];
  facts: { field: string; value: string; source_label: string | null; is_internal: boolean }[];
  wa: { url: string | null; defaultMode: string };
  steps: { step: string; task_no: number; label: string; email_id: string; status: string; detail: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null; started_at: string | null; finished_at: string | null }[];
}

const WA_MODE_LABEL: Record<string, string> = { borrador: 'borrador con aprobación', asistente: 'asistente automático', solo_recibir: 'solo recibir', solo_equipo: 'solo equipo' };

const fmt = (d: string | null, time = true) =>
  d ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}) }).format(new Date(d)) : '—';
const fmtLong = (d: string) =>
  new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

/* ------------------------------------------------------------- utilidades */
function useAction() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error ?? 'Error' });
      if (r.ok && r.message) setTimeout(() => setMsg(null), 4000);
    });
  return { pending, msg, run };
}

function Btn({ children, onClick, variant = 'ghost', disabled, title }: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; title?: string }) {
  const cls =
    variant === 'primary'
      ? 'bg-ink text-cream hover:bg-black'
      : variant === 'danger'
        ? 'border border-warn text-warn hover:bg-warn hover:text-cream'
        : 'border border-ink/30 hover:border-ink';
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className={`px-3 py-1.5 text-sm transition disabled:opacity-40 ${cls}`}>
      {children}
    </button>
  );
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border border-line bg-paper p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-[0.15em] text-stone">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function Flash({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p className={`mt-2 text-sm ${msg.ok ? 'text-ok' : 'text-warn'}`}>{msg.text}</p>;
}

/* ------------------------------------------------------- texto editable */
function EditableMd({ projectId, field, value, label, draft }: { projectId: string; field: 'briefing_md' | 'scope_md' | 'internal_context'; value: string | null; label: string; draft?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const { pending, msg, run } = useAction();
  return (
    <Card
      title={label}
      right={
        editing ? (
          <div className="flex gap-2">
            <Btn onClick={() => setEditing(false)}>Cancelar</Btn>
            <Btn variant="primary" disabled={pending} onClick={() => run(async () => { const r = await A.updateProjectText(projectId, field, text); if (r.ok) setEditing(false); return r; })}>
              Guardar
            </Btn>
          </div>
        ) : (
          <Btn onClick={() => { setText(value ?? ''); setEditing(true); }}>Editar</Btn>
        )
      }
    >
      {draft && !editing ? <p className="mb-3 inline-block bg-warn/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-warn">Borrador para revisión del arquitecto</p> : null}
      {editing ? <textarea value={text} onChange={(e) => setText(e.target.value)} className="h-[480px] w-full border border-line bg-white p-3 font-mono text-xs leading-relaxed outline-none focus:border-ink" /> : field === 'internal_context' ? <p className="whitespace-pre-wrap text-sm">{value || 'Sin notas internas.'}</p> : <Markdown md={value} />}
      <Flash msg={msg} />
    </Card>
  );
}

/* --------------------------------------------------------- documentos */
function Documents({ docs }: { docs: Doc[] }) {
  const { pending, msg, run } = useAction();
  const [preview, setPreview] = useState<Doc | null>(null);
  const folders = [...new Set(docs.map((d) => d.folder))].sort();
  return (
    <Card title={`Inventario documental · ${docs.length} archivo(s)`}>
      {!docs.length ? <p className="text-sm text-stone">No se han recibido documentos.</p> : null}
      {folders.map((f) => (
        <div key={f} className="mb-5">
          <p className="mb-2 font-mono text-xs text-stone">{f}/</p>
          <div className="divide-y divide-line border-y border-line">
            {docs
              .filter((d) => d.folder === f)
              .map((d) => {
                const foto = d.extracted?.foto as { estancia?: string; estado_visible?: string } | undefined;
                const plano = d.extracted?.plano as { es_estado_actual?: boolean | null; completo?: boolean | null } | undefined;
                return (
                  <div key={d.id} className="grid grid-cols-[64px_1fr_auto] items-start gap-3 py-3">
                    <button type="button" onClick={() => setPreview(d)} className="h-12 w-16 overflow-hidden border border-line bg-sand text-[10px] text-stone">
                      {d.mime.startsWith('image/') ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${d.id}`} alt="" className="h-full w-full object-cover" />
                      ) : (
                        'PDF'
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs">{d.new_name ?? d.original_name}</p>
                      <p className="truncate text-xs text-stone">Original: {d.original_name}</p>
                      <p className="mt-1 text-sm">{d.description}</p>
                      {foto ? <p className="text-xs text-stone">Estancia: {foto.estancia} · {foto.estado_visible}</p> : null}
                      {plano ? (
                        <p className="text-xs text-stone">
                          Estado actual: {plano.es_estado_actual === null ? '¿?' : plano.es_estado_actual ? 'sí' : 'no'} · Completo: {plano.completo === null ? '¿?' : plano.completo ? 'sí' : 'no'}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs ${d.status === 'ok' ? 'text-ok' : 'text-warn'}`}>{DOC_STATUS_LABEL[d.status]}</span>
                      <select
                        disabled={pending}
                        value={d.doc_type}
                        onChange={(e) => run(() => A.reclassifyDocument(d.id, e.target.value, (d.extracted?.subtipo as string) ?? null))}
                        className="border border-line bg-white px-1 py-0.5 text-xs"
                        title="Cambiar la clasificación"
                      >
                        {Object.entries(DOC_TYPE_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      {d.doc_type === 'certificado' || d.doc_type === 'otro' ? (
                        <select
                          disabled={pending}
                          value={(d.extracted?.subtipo as string) ?? ''}
                          onChange={(e) => run(() => A.reclassifyDocument(d.id, d.doc_type, e.target.value || null))}
                          className="border border-line bg-white px-1 py-0.5 text-xs"
                        >
                          <option value="">— subtipo —</option>
                          <option value="eficiencia_energetica">Cert. energético</option>
                          <option value="ite_iee">ITE / IEE</option>
                          <option value="normas_comunidad">Normas comunidad</option>
                          <option value="escritura">Escritura</option>
                          <option value="otro">Otro</option>
                        </select>
                      ) : null}
                      {d.classified_by === 'usuario' ? <span className="text-[10px] text-stone">corregido a mano</span> : null}
                      {d.status !== 'ok' ? (
                        <button type="button" className="text-[11px] underline" onClick={() => run(() => A.setDocumentStatus(d.id, 'ok'))}>
                          Marcar OK
                        </button>
                      ) : (
                        <button type="button" className="text-[11px] text-stone underline" onClick={() => run(() => A.setDocumentStatus(d.id, 'ilegible'))}>
                          Marcar ilegible
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}
      <Flash msg={msg} />
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={() => setPreview(null)}>
          <div className="h-[90vh] w-full max-w-5xl bg-paper" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm">
              <span className="font-mono">{preview.new_name ?? preview.original_name}</span>
              <button type="button" onClick={() => setPreview(null)}>
                Cerrar ✕
              </button>
            </div>
            {preview.mime.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/files/${preview.id}`} alt="" className="h-[calc(90vh-41px)] w-full object-contain" />
            ) : (
              <iframe src={`/api/files/${preview.id}`} className="h-[calc(90vh-41px)] w-full" title="Vista previa" />
            )}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/* ---------------------------------------------------------- pendientes */
function PendingList({ projectId, items }: { projectId: string; items: Pending[] }) {
  const [text, setText] = useState('');
  const [aud, setAud] = useState<'cliente' | 'interno'>('cliente');
  const { pending, msg, run } = useAction();
  const visible = items.filter((i) => i.status !== 'descartado');
  return (
    <Card title={`Listado de pendientes · ${visible.filter((i) => i.status !== 'recibido').length} abierto(s)`}>
      <ul className="divide-y divide-line">
        {visible.map((i) => (
          <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
            <span className={`w-20 text-xs ${i.status === 'recibido' ? 'text-ok' : 'text-warn'}`}>{PENDING_STATUS_LABEL[i.status]}</span>
            <span className={`flex-1 ${i.status === 'recibido' ? 'text-stone line-through' : ''}`}>
              {i.description}
              {i.audience === 'interno' ? <span className="ml-2 text-xs text-info">(interno)</span> : null}
              {i.source === 'manual' ? <span className="ml-2 text-xs text-stone">(añadido a mano)</span> : null}
            </span>
            {i.status !== 'recibido' ? (
              <button type="button" disabled={pending} className="text-xs underline" onClick={() => run(() => A.setPendingStatus(i.id, 'recibido'))}>
                Recibido
              </button>
            ) : null}
            <button type="button" disabled={pending} className="text-xs text-stone underline" onClick={() => run(() => A.setPendingStatus(i.id, 'descartado'))}>
              Quitar
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Añadir pendiente…" className="flex-1 border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-ink" />
        <select value={aud} onChange={(e) => setAud(e.target.value as 'cliente' | 'interno')} className="border border-line bg-white px-2 text-sm">
          <option value="cliente">Cliente</option>
          <option value="interno">Interno</option>
        </select>
        <Btn disabled={pending || !text.trim()} onClick={() => run(async () => { const r = await A.addPending(projectId, text, aud); if (r.ok) setText(''); return r; })}>
          Añadir
        </Btn>
      </div>
      <p className="mt-2 text-xs text-stone">Si cambias los pendientes, revisa el borrador del correo al cliente antes de enviarlo.</p>
      <Flash msg={msg} />
    </Card>
  );
}

/* ------------------------------------------------------------ checklist */
function Checklist({ projectId, value }: { projectId: string; value: ExpedienteData['project']['checklist'] }) {
  const [sections, setSections] = useState<ChecklistSection[]>(value?.sections ?? []);
  const [dirty, setDirty] = useState(false);
  const [newItem, setNewItem] = useState<Record<number, string>>({});
  const { pending, msg, run } = useAction();
  const update = (fn: (s: ChecklistSection[]) => ChecklistSection[]) => {
    setSections((s) => fn(structuredClone(s)));
    setDirty(true);
  };
  return (
    <Card title="Checklist de visita" right={dirty ? <Btn variant="primary" disabled={pending} onClick={() => run(async () => { const r = await A.updateChecklist(projectId, sections); if (r.ok) setDirty(false); return r; })}>Guardar</Btn> : null}>
      {value?.plantillas?.length ? <p className="mb-3 text-xs text-stone">Plantillas aplicadas: {value.plantillas.join(' · ')}</p> : null}
      {sections.map((s, si) => (
        <div key={si} className="mb-4">
          <p className="mb-1 text-sm font-semibold">{s.section}</p>
          <ul className="space-y-1">
            {s.items.map((it, ii) => (
              <li key={ii} className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={!!it.done} onChange={() => update((x) => { x[si].items[ii].done = !x[si].items[ii].done; return x; })} className="mt-1" />
                <span className="flex-1">
                  {it.text}
                  {it.reason ? <span className="text-xs text-stone"> — {it.reason}</span> : null}
                  {it.origin === 'agente' ? <span className="ml-1 text-[10px] uppercase text-info">agente</span> : null}
                </span>
                <button type="button" className="text-xs text-stone" onClick={() => update((x) => { x[si].items.splice(ii, 1); return x; })} title="Quitar">
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex gap-2">
            <input value={newItem[si] ?? ''} onChange={(e) => setNewItem({ ...newItem, [si]: e.target.value })} placeholder="Añadir comprobación…" className="flex-1 border-b border-line bg-transparent py-1 text-sm outline-none focus:border-ink" />
            <button
              type="button"
              className="text-xs underline"
              disabled={!newItem[si]?.trim()}
              onClick={() => {
                update((x) => { x[si].items.push({ text: newItem[si].trim(), reason: null, origin: 'usuario' }); return x; });
                setNewItem({ ...newItem, [si]: '' });
              }}
            >
              Añadir
            </button>
          </div>
        </div>
      ))}
      <Flash msg={msg} />
    </Card>
  );
}

/* ------------------------------------------------------------ borradores */
function DraftEditor({ draft, projectId, primary, hasWhatsApp }: { draft: Draft; projectId: string; primary?: boolean; hasWhatsApp?: boolean }) {
  const isWa = draft.channel === 'whatsapp';
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body_text);
  const [to, setTo] = useState(draft.to_emails.join(', '));
  const [cc, setCc] = useState(draft.cc_emails.join(', '));
  const { pending, msg, run } = useAction();
  const dirty = subject !== draft.subject || body !== draft.body_text || to !== draft.to_emails.join(', ') || cc !== draft.cc_emails.join(', ');
  const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const save = () => A.updateDraft(draft.id, { subject, body, to: list(to), cc: list(cc) });
  return (
    <Card
      title={`${isWa ? 'WhatsApp' : 'Correo'} · ${DRAFT_KIND_LABEL[draft.kind]}`}
      right={
        <span className="flex items-center gap-3 text-xs">
          {hasWhatsApp && !['solicitud_interna', 'aviso_interno'].includes(draft.kind) ? (
            <select
              value={draft.channel}
              disabled={pending}
              onChange={(e) => run(() => A.setDraftChannel(draft.id, e.target.value as 'email' | 'whatsapp'))}
              className="border border-line bg-white px-1 py-0.5"
              title="Canal por el que se enviará"
            >
              <option value="email">Enviar por correo</option>
              <option value="whatsapp">Enviar por WhatsApp</option>
            </select>
          ) : null}
          <span className="text-warn">{draft.requires_approval ? 'Requiere aprobación' : ''}</span>
        </span>
      }
    >
      {draft.compliance_flags.length ? (
        <div className="mb-3 border-l-2 border-warn bg-warn/5 p-2 text-xs text-warn">
          Revisar antes de enviar — posible contenido no permitido: {draft.compliance_flags.join(' · ')}
        </div>
      ) : null}
      {isWa ? (
        <p className="mb-2 text-sm text-stone">
          Se enviará a la <strong className="text-ink">conversación de WhatsApp</strong> del cliente. Solo es posible si el cliente ha escrito en las últimas 24 h (regla de Meta).
        </p>
      ) : null}
      <div className={`grid grid-cols-[60px_1fr] items-center gap-2 text-sm ${isWa ? 'hidden' : ''}`}>
        <span className="text-stone">Para</span>
        <input value={to} onChange={(e) => setTo(e.target.value)} className="border-b border-line bg-transparent py-1 outline-none focus:border-ink" />
        <span className="text-stone">CC</span>
        <input value={cc} onChange={(e) => setCc(e.target.value)} className="border-b border-line bg-transparent py-1 outline-none focus:border-ink" />
        <span className="text-stone">Asunto</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} className="border-b border-line bg-transparent py-1 font-medium outline-none focus:border-ink" />
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} className="mt-3 h-80 w-full border border-line bg-white p-3 text-sm leading-relaxed outline-none focus:border-ink" />
      {!isWa && !to.trim() ? <p className="text-xs text-warn">Falta el email del cliente: complétalo en la ficha del cliente.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {dirty ? <Btn disabled={pending} onClick={() => run(save)}>Guardar cambios</Btn> : null}
        {primary ? (
          <Btn
            variant="primary"
            disabled={pending || (!isWa && !to.trim())}
            onClick={() =>
              run(async () => {
                if (dirty) {
                  const s = await save();
                  if (!s.ok) return s;
                }
                return A.approveAndSend(projectId, draft.id);
              })
            }
          >
            {isWa ? 'Aprobar y enviar por WhatsApp' : 'Aprobar y enviar correo al cliente'}
          </Btn>
        ) : (
          <Btn
            variant="primary"
            disabled={pending || (!isWa && !to.trim())}
            onClick={() =>
              run(async () => {
                if (dirty) {
                  const s = await save();
                  if (!s.ok) return s;
                }
                return A.sendOtherDraft(draft.id);
              })
            }
          >
            Aprobar y enviar
          </Btn>
        )}
        <Btn variant="danger" disabled={pending} onClick={() => run(() => A.discardDraft(draft.id))}>
          Descartar
        </Btn>
      </div>
      <Flash msg={msg} />
    </Card>
  );
}

/* --------------------------------------------------------------- hilo */
function Thread({ emails }: { emails: Mail[] }) {
  const [open, setOpen] = useState<string | null>(emails.at(-1)?.id ?? null);
  return (
    <Card title={`Historial de correos del hilo · ${emails.length}`}>
      <div className="space-y-2">
        {emails.map((m) => (
          <div key={m.id} className={`border ${m.direction === 'saliente' ? 'border-ink/40 bg-sand/40' : 'border-line'}`}>
            <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm">
              <span className={`w-24 text-xs ${m.direction === 'saliente' ? 'text-info' : 'text-stone'}`}>
                {m.direction === 'saliente' ? 'Enviado' : 'Recibido'}
                {m.channel === 'whatsapp' ? ' · WA' : ''}
              </span>
              <span className="w-56 truncate">
                {m.direction === 'saliente' ? (m.channel === 'whatsapp' ? '→ WhatsApp del cliente' : `→ ${m.to_emails.join(', ')}`) : m.from_name ?? m.from_email ?? m.from_phone}
              </span>
              <span className="flex-1 truncate text-ink/70">{m.subject}</span>
              <span className="text-xs text-stone">{fmt(m.sent_at ?? m.created_at)}</span>
            </button>
            {open === m.id ? (
              <div className="border-t border-line px-3 py-3">
                <p className="mb-2 text-xs text-stone">
                  {m.channel === 'whatsapp'
                    ? `WhatsApp · ${m.direction === 'saliente' ? 'Wink → cliente' : `${m.from_name ?? ''} ${m.from_phone ?? ''}`}`
                    : `De: ${m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email} · Para: ${m.to_emails.join(', ')}`}
                  {m.cc_emails.length ? ` · CC: ${m.cc_emails.join(', ')}` : ''}
                  {m.sender_type === 'personal' ? ' · personal de Wink' : ''}
                </p>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm">{m.body_text}</pre>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------- panel lateral */
function ClientCard({ data }: { data: ExpedienteData }) {
  const c = data.project.clients;
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ full_name: c?.full_name ?? '', email: c?.email ?? '', phone: c?.phone ?? '' });
  const { pending, msg, run } = useAction();
  return (
    <Card title="Cliente" right={<Btn onClick={() => setEdit(!edit)}>{edit ? 'Cancelar' : 'Editar'}</Btn>}>
      {edit ? (
        <div className="space-y-2 text-sm">
          {(['full_name', 'email', 'phone'] as const).map((k) => (
            <input key={k} value={v[k]} placeholder={{ full_name: 'Nombre', email: 'Email', phone: 'Teléfono' }[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="w-full border-b border-line bg-transparent py-1 outline-none focus:border-ink" />
          ))}
          <Btn variant="primary" disabled={pending} onClick={() => run(async () => { const r = await A.updateClient(data.project.id, v); if (r.ok) setEdit(false); return r; })}>
            Guardar
          </Btn>
        </div>
      ) : (
        <dl className="space-y-1 text-sm">
          <div className="font-medium">{c?.full_name ?? 'Sin nombre'}</div>
          <div className={c?.email ? '' : 'text-warn'}>{c?.email ?? 'Sin email'}</div>
          <div className={c?.phone ? '' : 'text-warn'}>{c?.phone ?? 'Sin teléfono'}</div>
        </dl>
      )}
      <Flash msg={msg} />
    </Card>
  );
}

function VisitCard({ data }: { data: ExpedienteData }) {
  const [custom, setCustom] = useState('');
  const { pending, msg, run } = useAction();
  const proposed = data.slots.filter((s) => s.status === 'propuesto');
  return (
    <Card title="Visita del inmueble">
      {data.project.visit_at ? (
        <p className="text-sm">
          <span className="font-medium text-ok">Agendada:</span> {fmtLong(data.project.visit_at)}
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-stone">Huecos propuestos según la agenda (incluidos en el correo al cliente):</p>
          <ul className="space-y-1">
            {proposed.map((s, i) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {i + 1}. {fmtLong(s.starts_at)}
                </span>
                <button type="button" disabled={pending} className="text-xs underline" onClick={() => run(() => A.scheduleVisit(data.project.id, { slotId: s.id }))}>
                  Agendar
                </button>
              </li>
            ))}
            {!proposed.length ? <li className="text-sm text-stone">Sin huecos propuestos.</li> : null}
          </ul>
          <div className="mt-3 flex gap-2">
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="flex-1 border border-line bg-white px-2 py-1 text-sm" />
            <Btn disabled={pending || !custom} onClick={() => run(() => A.scheduleVisit(data.project.id, { startIso: new Date(custom).toISOString() }))}>
              Agendar visita
            </Btn>
          </div>
        </>
      )}
      <Flash msg={msg} />
    </Card>
  );
}

/* ---------------------------------------------------------------- vista */
const TABS = ['Resumen', 'Documentos', 'Briefing', 'Pendientes', 'Alcance', 'Checklist', 'Correos', 'Actividad'] as const;

export function ExpedienteView({ data }: { data: ExpedienteData; currentUserId: string }) {
  const p = data.project;
  const [tab, setTab] = useState<(typeof TABS)[number]>('Resumen');
  const { pending, msg, run } = useAction();
  const mainDraft = data.drafts.find((d) => d.kind === 'pendientes_y_visita' && d.status === 'borrador');
  const otherDrafts = data.drafts.filter((d) => d !== mainDraft && d.status === 'borrador');
  const openInc = data.inconsistencies.filter((i) => !i.resolved_at);
  const prop = p.properties;

  return (
    <div>
      {/* Cabecera */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-ink pb-5">
        <div>
          <p className="font-mono text-sm text-stone">{p.code}</p>
          <h1 className="text-2xl font-semibold leading-tight">{p.title ?? p.clients?.full_name ?? 'Expediente'}</h1>
          <p className="mt-1 text-sm text-stone">
            <span className={p.status === 'procesando' ? 'animate-pulse text-info' : 'text-ink'}>{STATUS_LABEL[p.status]}</span> · {ORIGIN_LABEL[p.origin]}
            {p.origin_staff ? ` (${p.origin_staff.full_name})` : ''} · Recibido {fmt(p.received_at)}
            {p.approved_at ? ` · Aprobado ${fmt(p.approved_at)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-stone">Responsable</span>
            <select
              value={p.responsible?.id ?? ''}
              disabled={pending}
              onChange={(e) => run(() => A.setResponsible(p.id, e.target.value || null))}
              className="border border-line bg-white px-2 py-1.5 text-sm"
            >
              <option value="">Sin asignar</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </label>
          {p.wa_conversation_id ? (
            <label className="flex items-center gap-2 text-sm" title="Cómo se responde a este cliente por WhatsApp">
              <span className="text-stone">WhatsApp</span>
              <select
                value={p.wa_reply_mode ?? ''}
                disabled={pending}
                onChange={(e) => run(() => A.setWaMode(p.id, (e.target.value || null) as Parameters<typeof A.setWaMode>[1]))}
                className="border border-line bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Por defecto ({WA_MODE_LABEL[data.wa.defaultMode] ?? data.wa.defaultMode})</option>
                <option value="borrador">Borrador con aprobación</option>
                <option value="asistente">Asistente automático</option>
                <option value="solo_recibir">Solo recibir</option>
                <option value="solo_equipo">Solo equipo</option>
              </select>
              {data.wa.url ? (
                <a href={data.wa.url} target="_blank" className="text-xs underline">
                  Abrir conversación
                </a>
              ) : null}
            </label>
          ) : null}
          <Btn disabled={pending || !!p.approved_at} onClick={() => run(() => A.approveProject(p.id))}>
            {p.approved_at ? 'Expediente aprobado' : 'Aprobar expediente'}
          </Btn>
          {mainDraft ? (
            <Btn variant="primary" onClick={() => setTab('Correos')}>
              {mainDraft.channel === 'whatsapp' ? 'Aprobar y enviar por WhatsApp' : 'Aprobar y enviar correo al cliente'}
            </Btn>
          ) : null}
          <Btn onClick={() => setTab('Resumen')}>Agendar visita</Btn>
          <a href={`/api/projects/${p.id}/pdf`} target="_blank" className="border border-ink/30 px-3 py-1.5 text-sm hover:border-ink">
            Exportar PDF
          </a>
        </div>
      </div>
      <Flash msg={msg} />
      {(() => {
        // Progreso del último correo en proceso de este expediente
        const lastEmail = data.steps.filter((s) => s.started_at).sort((a, b) => (b.started_at! > a.started_at! ? 1 : -1))[0]?.email_id;
        const current = data.steps.filter((s) => s.email_id === lastEmail);
        const busy = p.status === 'procesando' || current.some((s) => s.status === 'en_curso' || s.status === 'pendiente');
        return busy && current.length ? (
          <div className="-mt-2 mb-6 border border-info/30 bg-paper p-4">
            <AgentProgress steps={current} />
          </div>
        ) : null;
      })()}

      {/* Pestañas */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? 'border-ink font-medium' : 'border-transparent text-stone hover:text-ink'}`}>
            {t}
            {t === 'Pendientes' ? ` (${data.pending.filter((i) => ['pendiente', 'pedido'].includes(i.status)).length})` : ''}
            {t === 'Documentos' ? ` (${data.docs.length})` : ''}
            {t === 'Correos' && (mainDraft || otherDrafts.length) ? ' ●' : ''}
          </button>
        ))}
      </div>

      {tab === 'Resumen' ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="space-y-5 lg:col-span-2">
            <Card title="Inmueble">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
                {[
                  ['Dirección', prop?.address],
                  ['Superficie', prop?.surface_m2 ? `${String(prop.surface_m2).replace('.', ',')} m²` : null],
                  ['Planta', prop?.floor],
                  ['Año', prop?.building_year],
                  ['Tipología', prop?.typology],
                  ['Ref. catastral', prop?.cadastral_ref],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <dt className="text-xs text-stone">{k}</dt>
                    <dd>{v ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            </Card>
            {openInc.length ? (
              <Card title={`Incoherencias · ${openInc.length}`}>
                <ul className="space-y-2">
                  {openInc.map((i) => (
                    <li key={i.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="text-warn">⚠ {i.description}</span>
                      <button type="button" className="shrink-0 text-xs underline" onClick={() => run(() => A.resolveInconsistency(i.id))}>
                        Resuelta
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Card title="Datos extraídos y su fuente">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {data.facts.map((f, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-3 align-top font-mono text-xs text-stone">{f.field}</td>
                      <td className="py-1 pr-3 align-top">{f.value}</td>
                      <td className="py-1 align-top text-xs text-stone">
                        {f.source_label}
                        {f.is_internal ? ' · interno' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
          <div className="space-y-5">
            <ClientCard data={data} />
            <VisitCard data={data} />
            <EditableMd projectId={p.id} field="internal_context" value={p.internal_context} label="Notas internas del personal (nunca van al cliente)" />
          </div>
        </div>
      ) : null}

      {tab === 'Documentos' ? <Documents docs={data.docs} /> : null}
      {tab === 'Briefing' ? <EditableMd projectId={p.id} field="briefing_md" value={p.briefing_md} label="Briefing técnico" /> : null}
      {tab === 'Pendientes' ? <PendingList projectId={p.id} items={data.pending} /> : null}
      {tab === 'Alcance' ? <EditableMd projectId={p.id} field="scope_md" value={p.scope_md} label="Alcance técnico preliminar" draft /> : null}
      {tab === 'Checklist' ? <Checklist projectId={p.id} value={p.checklist} /> : null}
      {tab === 'Correos' ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            {mainDraft ? <DraftEditor key={mainDraft.id} draft={mainDraft} projectId={p.id} primary hasWhatsApp={!!p.wa_conversation_id} /> : null}
            {otherDrafts.map((d) => (
              <DraftEditor key={d.id} draft={d} projectId={p.id} hasWhatsApp={!!p.wa_conversation_id} />
            ))}
            {!mainDraft && !otherDrafts.length ? <Card title="Borradores"><p className="text-sm text-stone">No hay correos pendientes de aprobar.</p></Card> : null}
          </div>
          <Thread emails={data.emails} />
        </div>
      ) : null}
      {tab === 'Actividad' ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Pasos del agente">
            <ul className="space-y-1 text-sm">
              {data.steps.map((s, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    <span className={s.status === 'ok' ? 'text-ok' : s.status === 'error' ? 'text-warn' : 'text-stone'}>●</span> {s.step} — {s.detail ?? s.status}
                  </span>
                  <span className="shrink-0 text-xs text-stone">
                    {s.model ? `${s.model} · ` : ''}
                    {s.started_at && s.finished_at ? `${((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000).toFixed(1)} s` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Auditoría">
            <ul className="space-y-1 text-sm">
              {data.events.map((e) => (
                <li key={e.id} className="flex justify-between gap-3">
                  <span>
                    <span className="text-xs uppercase text-stone">{e.actor_type}</span> {e.action.replaceAll('_', ' ')}
                  </span>
                  <span className="shrink-0 text-xs text-stone">{fmt(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
