/**
 * Ingesta idempotente: guarda el correo y sus adjuntos y encola su procesado.
 * Rápida (no llama al LLM): el trabajo pesado lo hace el worker.
 */
import type { NormalizedEmail } from '@/email/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { checkAttachment, safeFilename } from '@/storage/files';
import { putFile } from '@/storage/storage';
import { loadSettings } from '@/core/settings';
import { enqueue } from '@/queue/jobs';
import { sha256, maskEmail } from '@/lib/pii';
import { log } from '@/lib/log';
import { audit } from '@/core/audit';

export interface IngestResult {
  emailId: string | null;
  duplicate: boolean;
  skipped?: 'propio';
}

/** Adjuntos incrustados pequeños (logos de firma) no son documentación del encargo. */
const isSignatureImage = (a: NormalizedEmail['attachments'][number]) => a.inline && a.size < 60_000;

export async function ingestEmail(email: NormalizedEmail): Promise<IngestResult> {
  const sb = supabaseAdmin();
  const settings = await loadSettings();

  // Nuestros propios envíos (copia en bandeja, rebotes de prueba) no se procesan
  if (email.channel !== 'whatsapp' && email.from.email.toLowerCase() === settings.agent_mailbox.toLowerCase()) {
    return { emailId: null, duplicate: false, skipped: 'propio' };
  }

  // Idempotencia: por id del proveedor y por cabecera Message-ID
  const { data: byProvider } = await sb
    .from('emails')
    .select('id')
    .eq('provider', email.provider)
    .eq('provider_message_id', email.providerMessageId)
    .limit(1);
  if (byProvider?.length) return { emailId: byProvider[0].id, duplicate: true };
  if (email.messageId) {
    const { data: byMsgId } = await sb.from('emails').select('id').eq('message_id_header', email.messageId).eq('direction', 'entrante').limit(1);
    if (byMsgId?.length) return { emailId: byMsgId[0].id, duplicate: true };
  }

  const { data: row, error } = await sb
    .from('emails')
    .insert({
      direction: 'entrante',
      provider: email.provider,
      provider_message_id: email.providerMessageId,
      message_id_header: email.messageId,
      in_reply_to: email.inReplyTo,
      references_ids: email.references,
      from_email: email.from.email || null,
      from_name: email.from.name,
      channel: email.channel ?? 'email',
      from_phone: email.fromPhone ?? null,
      wa_conversation_id: email.waConversationId ?? null,
      to_emails: email.to.map((a) => a.email),
      cc_emails: email.cc.map((a) => a.email),
      subject: email.subject,
      body_text: email.text,
      body_html: email.html,
      sent_at: email.date.toISOString(),
      headers: pickHeaders(email.headers),
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return { emailId: null, duplicate: true }; // carrera entre dos ingestas
    throw new Error(`No se pudo guardar el correo: ${error.message}`);
  }
  const emailId = row.id as string;

  if (email.raw) {
    const rawPath = `_buzon/${emailId}/original.eml`;
    await putFile(rawPath, email.raw, 'message/rfc822');
    await sb.from('emails').update({ raw_storage_path: rawPath }).eq('id', emailId);
  }

  // Adjuntos: validación de tipo real y límites; nunca se ejecutan
  const limits = settings.file_limits;
  const docs = email.attachments.filter((a) => !isSignatureImage(a));
  let total = 0;
  const rows = [];
  for (const [i, a] of docs.entries()) {
    total += a.size;
    let check = checkAttachment(a, limits);
    if (check.accepted && i >= limits.max_files) check = { accepted: false, mime: check.mime, reason: `Supera el máximo de ${limits.max_files} adjuntos` };
    if (check.accepted && total > limits.max_total_mb * 1024 * 1024)
      check = { accepted: false, mime: check.mime, reason: `El correo supera ${limits.max_total_mb} MB en total` };
    const hash = sha256(a.content);
    let storagePath: string | null = null;
    if (check.accepted) {
      storagePath = `_buzon/${emailId}/${String(i + 1).padStart(2, '0')}_${safeFilename(a.filename)}`;
      await putFile(storagePath, a.content, check.mime);
    }
    rows.push({
      email_id: emailId,
      filename: a.filename,
      content_type: check.mime,
      size_bytes: a.size,
      sha256: hash,
      storage_path: storagePath,
      accepted: check.accepted,
      reject_reason: check.reason ?? null,
    });
  }
  if (rows.length) {
    const { error: attErr } = await sb.from('email_attachments').insert(rows);
    if (attErr) throw new Error(`No se pudieron guardar los adjuntos: ${attErr.message}`);
  }

  await enqueue('process_email', { emailId }, `email:${emailId}`);
  await audit('correo_recibido', { actorType: 'sistema', payload: { emailId, adjuntos: rows.length, rechazados: rows.filter((r) => !r.accepted).length } });
  log.info('Correo ingerido', { emailId, from: maskEmail(email.from.email), adjuntos: rows.length });
  return { emailId, duplicate: false };
}

const KEEP_HEADERS = ['x-wink-target-project', 'x-wink-visit-start', 'x-wink-visit-end', 'x-wink-kind', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'list-id', 'list-unsubscribe', 'x-auto-response-suppress', 'date', 'message-id'];
function pickHeaders(h: Record<string, string>) {
  return Object.fromEntries(Object.entries(h).filter(([k]) => KEEP_HEADERS.includes(k)));
}
