/**
 * Tarea 2 — Inventario documental: clasifica cada adjunto leyendo su contenido, lo renombra
 * (código_tipo_descripcion_fecha), lo guarda en su carpeta, extrae datos y detecta
 * duplicados e ilegibles.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { copyFile, getFile } from '@/storage/storage';
import { folderForDocType } from '@/storage/files';
import { slugify, yyyymmdd, fileExtension, parseSpanishNumber } from '@/lib/text';
import { llm } from './llm';
import { prepareImage, pdfPageCount, isEncryptedPdf } from './llm/media';
import { DocumentAnalysisSchema, type DocumentAnalysis } from './schemas';
import { SYSTEM_DOCUMENT } from './prompts';
import type { ContentPart } from './llm/types';
import { folderSync } from '@/storage/sync';
import { log } from '@/lib/log';

const TYPE_LABEL: Record<string, string> = {
  foto: 'Foto',
  plano: 'Plano',
  nota_simple: 'Nota simple',
  certificado: 'Certificado',
  contrato: 'Contrato',
  otro: 'Documento',
};

interface AttachmentRow {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  storage_path: string | null;
  accepted: boolean;
  reject_reason: string | null;
}

export interface ClassifySummary {
  total: number;
  porTipo: Record<string, number>;
  duplicados: number;
  ilegibles: number;
  rechazados: { filename: string; reason: string }[];
  usage: { input: number; output: number };
  model: string | null;
}

/** Ejecuta tareas con concurrencia limitada. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

async function analyze(att: AttachmentRow, content: Buffer, context: string): Promise<{ a: DocumentAnalysis; model: string; usage: { input: number; output: number } } | { error: string }> {
  const parts: ContentPart[] = [];
  if (att.content_type === 'application/pdf') {
    if (isEncryptedPdf(content)) return { error: 'PDF protegido con contraseña' };
    parts.push({ type: 'pdf', data: content, title: att.filename });
  } else {
    try {
      const img = await prepareImage(content);
      parts.push({ type: 'image', data: img.data, mime: img.mime });
    } catch {
      return { error: att.content_type.includes('heic') ? 'Formato HEIC no legible en el servidor: pedir en JPG' : 'Imagen dañada o no legible' };
    }
  }
  parts.push({ type: 'text', text: `Nombre original del archivo: "${att.filename}".\nContexto del encargo: ${context}\nClasifica el archivo y extrae los datos.` });
  const r = await llm().run({
    task: 'clasificar_documento',
    tier: 'fast',
    system: SYSTEM_DOCUMENT,
    content: parts,
    toolName: 'registrar_documento',
    toolDescription: 'Registra la clasificación y los datos extraídos del documento',
    schema: DocumentAnalysisSchema,
    maxTokens: 2000,
  });
  return { a: r.data, model: r.model, usage: r.usage };
}

/** Datos estructurados del documento → filas de facts con su fuente. */
function factsFromDocument(projectId: string, docId: string, label: string, a: DocumentAnalysis) {
  const rows: { project_id: string; field: string; value: string; value_num: number | null; source_type: 'document'; source_id: string; source_label: string; page: number | null; confidence: number }[] = [];
  const push = (field: string, value: string | number | null | undefined, page: number | null = null) => {
    if (value === null || value === undefined || value === '') return;
    if (rows.some((r) => r.field === field && r.value === String(value))) return;
    rows.push({
      project_id: projectId,
      field,
      value: String(value),
      value_num: typeof value === 'number' ? value : field.endsWith('_m2') || field.endsWith('year') ? parseSpanishNumber(String(value)) : null,
      source_type: 'document',
      source_id: docId,
      source_label: page ? `${label} (pág. ${page})` : label,
      page,
      confidence: a.confianza,
    });
  };
  const ns = a.nota_simple;
  if (ns) {
    push('property.cadastral_ref', ns.referencia_catastral);
    push('property.registry_finca', ns.finca_registral);
    push('property.address', ns.direccion);
    push('property.surface_m2', ns.superficie_construida_m2);
    push('property.useful_surface_m2', ns.superficie_util_m2);
    if (ns.titulares.length) push('property.owners', ns.titulares.join('; '));
    push('property.charges', ns.cargas.length ? ns.cargas.join('; ') : 'Libre de cargas');
  }
  const PHOTO_ALLOWED = new Set(['property.elevator']); // lo único que una foto puede mostrar por sí misma
  for (const d of a.datos) {
    if (d.campo === 'property.surface_m2' && ns?.superficie_construida_m2) continue;
    if (a.tipo === 'foto' && !PHOTO_ALLOWED.has(d.campo)) continue;
    if (/\b(seg[uú]n|no verificad|no consta|contexto del encargo)\b/i.test(d.valor)) continue; // valores con dudas: no son datos
    push(d.campo, d.valor, d.pagina);
  }
  return rows;
}

export async function classifyEmailAttachments(opts: { projectId: string; projectCode: string; emailId: string; context: string }): Promise<ClassifySummary> {
  const sb = supabaseAdmin();
  const { data: atts } = await sb.from('email_attachments').select('*').eq('email_id', opts.emailId).order('created_at');
  const attachments = (atts ?? []) as AttachmentRow[];
  const summary: ClassifySummary = { total: 0, porTipo: {}, duplicados: 0, ilegibles: 0, rechazados: [], usage: { input: 0, output: 0 }, model: null };

  for (const r of attachments.filter((a) => !a.accepted)) summary.rechazados.push({ filename: r.filename, reason: r.reject_reason ?? 'No admitido' });

  // Ya clasificados en un intento anterior → no repetir
  const { data: done } = await sb.from('documents').select('attachment_id').eq('email_id', opts.emailId);
  const doneIds = new Set((done ?? []).map((d) => d.attachment_id));
  const todo = attachments.filter((a) => a.accepted && a.storage_path && !doneIds.has(a.id));

  // Duplicados exactos (mismo hash) dentro del expediente o del propio correo
  const { data: projectDocs } = await sb.from('documents').select('id,sha256').eq('project_id', opts.projectId);
  const seen = new Map<string, string>((projectDocs ?? []).map((d) => [d.sha256, d.id]));
  const firstInEmail = new Map<string, AttachmentRow>();
  const toAnalyze: AttachmentRow[] = [];
  const dupOf = new Map<string, string>(); // attachment id → sha del original
  for (const a of todo) {
    if (seen.has(a.sha256) || firstInEmail.has(a.sha256)) dupOf.set(a.id, a.sha256);
    else {
      firstInEmail.set(a.sha256, a);
      toAnalyze.push(a);
    }
  }

  const today = yyyymmdd(new Date());
  const usedNames = new Set<string>();
  const uniqueName = (base: string, ext: string) => {
    let name = `${base}.${ext}`;
    for (let n = 2; usedNames.has(name); n++) name = `${base}_${n}.${ext}`;
    usedNames.add(name);
    return name;
  };
  const { data: existingNames } = await sb.from('documents').select('new_name').eq('project_id', opts.projectId);
  (existingNames ?? []).forEach((d) => d.new_name && usedNames.add(d.new_name));

  const results = await pool(toAnalyze, 4, async (att) => {
    const content = await getFile(att.storage_path!);
    const res = await analyze(att, content, opts.context);
    const ext = fileExtension(att.filename, att.content_type);
    if ('error' in res) {
      const newName = uniqueName(`${opts.projectCode}_otro_ilegible-${slugify(att.filename.replace(/\.[^.]+$/, ''), 20)}_${today}`, ext);
      return { att, a: null as DocumentAnalysis | null, error: res.error, newName, folder: '05_Otros' as const, content };
    }
    const a = res.a;
    summary.usage.input += res.usage.input;
    summary.usage.output += res.usage.output;
    summary.model = res.model;
    const date = a.fecha_documento && /^\d{4}-\d{2}-\d{2}$/.test(a.fecha_documento) ? a.fecha_documento.replace(/-/g, '') : today;
    const newName = uniqueName(`${opts.projectCode}_${a.tipo}_${slugify(a.descripcion_corta, 32) || 'documento'}_${date}`, ext);
    return { att, a, error: null as string | null, newName, folder: folderForDocType(a.tipo), content };
  });

  const shaToDoc = new Map<string, string>(seen);
  for (const r of results) {
    const path = `${opts.projectCode}/${r.folder}/${r.newName}`;
    await copyFile(r.att.storage_path!, path);
    const legible = r.a ? r.a.legible && (r.a.plano?.legible ?? true) : false;
    const { data: doc, error } = await sb
      .from('documents')
      .insert({
        project_id: opts.projectId,
        email_id: opts.emailId,
        attachment_id: r.att.id,
        doc_type: r.a?.tipo ?? 'otro',
        original_name: r.att.filename,
        new_name: r.newName,
        folder: r.folder,
        storage_path: path,
        mime: r.att.content_type,
        size_bytes: r.att.size_bytes,
        sha256: r.att.sha256,
        page_count: r.att.content_type === 'application/pdf' ? pdfPageCount(r.content) : null,
        description: r.a?.resumen ?? r.error,
        extracted: r.a ?? { error: r.error },
        status: legible ? 'ok' : 'ilegible',
        confidence: r.a?.confianza ?? null,
      })
      .select('id')
      .single();
    if (error) throw new Error(`No se pudo registrar el documento: ${error.message}`);
    shaToDoc.set(r.att.sha256, doc.id);
    summary.total++;
    const tipo = r.a?.tipo ?? 'otro';
    summary.porTipo[tipo] = (summary.porTipo[tipo] ?? 0) + 1;
    if (!legible) summary.ilegibles++;
    if (r.a && legible) {
      const facts = factsFromDocument(opts.projectId, doc.id, `${TYPE_LABEL[tipo]} «${r.newName}»`, r.a);
      if (facts.length) await sb.from('facts').insert(facts);
    }
    folderSync()
      .upload(opts.projectCode, r.folder, r.newName, r.content, r.att.content_type)
      .catch((e) => log.warn('Sincronización de carpeta fallida', { error: String(e) }));
  }

  // Duplicados: se registran apuntando al original, sin volver a analizarlos
  for (const a of todo.filter((x) => dupOf.has(x.id))) {
    const originalId = shaToDoc.get(a.sha256) ?? null;
    const { data: orig } = originalId ? await sb.from('documents').select('doc_type,folder,new_name').eq('id', originalId).single() : { data: null };
    await sb.from('documents').insert({
      project_id: opts.projectId,
      email_id: opts.emailId,
      attachment_id: a.id,
      doc_type: orig?.doc_type ?? 'otro',
      original_name: a.filename,
      new_name: null,
      folder: orig?.folder ?? '05_Otros',
      storage_path: a.storage_path!,
      mime: a.content_type,
      size_bytes: a.size_bytes,
      sha256: a.sha256,
      description: `Duplicado de ${orig?.new_name ?? 'otro archivo'}`,
      status: 'duplicado',
      duplicate_of: originalId,
    });
    summary.total++;
    summary.duplicados++;
  }
  return summary;
}

export function describeSummary(s: ClassifySummary): string {
  const names: Record<string, [string, string]> = {
    foto: ['foto', 'fotos'],
    plano: ['plano', 'planos'],
    nota_simple: ['nota simple', 'notas simples'],
    certificado: ['certificado', 'certificados'],
    contrato: ['contrato', 'contratos'],
    otro: ['otro', 'otros'],
  };
  const parts = Object.entries(s.porTipo).map(([t, n]) => `${n} ${names[t]?.[n === 1 ? 0 : 1] ?? t}`);
  const extra = [
    s.duplicados ? `${s.duplicados} duplicado${s.duplicados > 1 ? 's' : ''}` : '',
    s.ilegibles ? `${s.ilegibles} ilegible${s.ilegibles > 1 ? 's' : ''}` : '',
    s.rechazados.length ? `${s.rechazados.length} rechazado${s.rechazados.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  if (!s.total && !s.rechazados.length) return 'Sin adjuntos';
  return `${s.total} archivo${s.total === 1 ? '' : 's'}: ${parts.join(', ')}${extra.length ? ` · ${extra.join(', ')}` : ''}`;
}
