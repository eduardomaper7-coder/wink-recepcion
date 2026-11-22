import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { Address, NormalizedEmail } from './types';

function addresses(a?: AddressObject | AddressObject[]): Address[] {
  if (!a) return [];
  const list = Array.isArray(a) ? a : [a];
  return list
    .flatMap((o) => o.value)
    .filter((v) => !!v.address)
    .map((v) => ({ email: v.address!.toLowerCase(), name: v.name || null }));
}

function idList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : v.split(/\s+/)).map((s) => s.trim()).filter(Boolean);
}

/** Convierte un .eml (RFC 5322) en el modelo normalizado. */
export async function parseRawEmail(raw: Buffer, provider: string, providerMessageId: string): Promise<NormalizedEmail> {
  const mail: ParsedMail = await simpleParser(raw, { skipImageLinks: true });
  const headers: Record<string, string> = {};
  for (const [k, v] of mail.headers) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
    else if (v && typeof v === 'object' && 'text' in (v as object)) headers[k.toLowerCase()] = String((v as { text: string }).text);
    else if (v instanceof Date) headers[k.toLowerCase()] = v.toISOString();
  }
  const from = addresses(mail.from)[0] ?? { email: 'desconocido@desconocido', name: null };
  return {
    provider,
    providerMessageId,
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references: idList(mail.references),
    from,
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    replyTo: addresses(mail.replyTo)[0] ?? null,
    subject: mail.subject ?? '',
    text: mail.text ?? htmlToText(typeof mail.html === 'string' ? mail.html : ''),
    html: typeof mail.html === 'string' ? mail.html : null,
    date: mail.date ?? new Date(),
    headers,
    attachments: mail.attachments
      .filter((a) => a.content?.length)
      .map((a) => ({
        filename: a.filename ?? `adjunto.${(a.contentType ?? 'bin').split('/')[1] ?? 'bin'}`,
        contentType: (a.contentType ?? 'application/octet-stream').toLowerCase(),
        size: a.size ?? a.content.length,
        content: a.content,
        inline: a.contentDisposition === 'inline' && !!a.cid,
      })),
    raw,
  };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
