import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { checkIntegrationAuth, phoneFromWa } from '@/integrations/whatsapp';
import { ingestEmail } from '@/ingest/ingest';
import { runWorker } from '@/queue/worker';
import type { NormalizedAttachment, NormalizedEmail } from '@/email/types';
import { loadSettings } from '@/core/settings';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Attachment = z.object({ url: z.string().url(), filename: z.string().max(200), mime: z.string().max(100), caption: z.string().max(1000).nullish() });

const Body = z.object({
  /** lead_visit_booked: el asistente reservó la visita → expediente nuevo. message: mensaje de cliente con expediente o del personal */
  kind: z.enum(['lead_visit_booked', 'message']),
  /** Clave única del envío (idempotencia): wamid del mensaje o "lead:<id>:<fecha visita>" */
  key: z.string().min(3).max(300),
  conversationId: z.string().min(1),
  from: z.object({ waId: z.string().min(6), name: z.string().nullish(), email: z.string().email().nullish() }),
  text: z.string().max(60_000).default(''),
  attachments: z.array(Attachment).max(30).default([]),
  /** Personal: expediente elegido para este mensaje */
  projectId: z.string().uuid().nullish(),
  visit: z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }).nullish() }).nullish(),
  sentAt: z.string().datetime({ offset: true }).nullish(),
});

/**
 * Entrada de WhatsApp → mismo pipeline que el correo (mismo expediente, mismos pasos y reglas).
 * Los adjuntos llegan como URLs firmadas de corta duración del Storage de la app de WhatsApp.
 */
export async function POST(req: Request) {
  if (!checkIntegrationAuth(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Petición no válida', issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const b = parsed.data;
  const limits = (await loadSettings()).file_limits;

  // Descarga de adjuntos (con límite de tamaño); un fallo de descarga no bloquea el resto
  const attachments: NormalizedAttachment[] = [];
  let total = 0;
  // Solo se descargan archivos del Storage de Supabase (evita que la API se use para pedir URLs arbitrarias)
  const allowedHost = (u: string) => {
    try {
      const h = new URL(u).hostname;
      return new URL(u).protocol === 'https:' && (h.endsWith('.supabase.co') || h.endsWith('.supabase.in'));
    } catch {
      return false;
    }
  };
  for (const a of b.attachments) {
    if (!allowedHost(a.url)) {
      log.warn('Adjunto de WhatsApp con URL no permitida', { filename: a.filename });
      continue;
    }
    try {
      const res = await fetch(a.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      total += buf.length;
      if (buf.length > limits.max_file_mb * 1024 * 1024 || total > limits.max_total_mb * 1024 * 1024) {
        log.warn('Adjunto de WhatsApp descartado por tamaño', { filename: a.filename });
        continue;
      }
      attachments.push({ filename: a.filename, contentType: a.mime, size: buf.length, content: buf });
    } catch (e) {
      log.warn('No se pudo descargar un adjunto de WhatsApp', { filename: a.filename, error: String(e) });
    }
  }

  const phone = phoneFromWa(b.from.waId);
  const name = b.from.name ?? null;
  const headers: Record<string, string> = { 'x-wink-kind': b.kind };
  if (b.projectId) headers['x-wink-target-project'] = b.projectId;
  if (b.visit?.start) headers['x-wink-visit-start'] = b.visit.start;
  if (b.visit?.end) headers['x-wink-visit-end'] = b.visit.end;

  const email: NormalizedEmail = {
    provider: 'whatsapp',
    providerMessageId: b.key,
    messageId: null,
    inReplyTo: null,
    references: [],
    from: { email: b.from.email ?? '', name },
    to: [],
    cc: [],
    subject: b.kind === 'lead_visit_booked' ? `WhatsApp · Visita reservada · ${name ?? phone ?? ''}` : `WhatsApp · ${name ?? phone ?? ''}`,
    text: b.text,
    html: null,
    date: b.sentAt ? new Date(b.sentAt) : new Date(),
    headers,
    attachments,
    channel: 'whatsapp',
    fromPhone: phone,
    waConversationId: b.conversationId,
  };

  const r = await ingestEmail(email);
  if (r.emailId && !r.duplicate) after(() => runWorker({ budgetMs: 280_000 }));
  return NextResponse.json({ emailId: r.emailId, duplicate: r.duplicate, attachments: attachments.length });
}
