/**
 * Heurísticas deterministas sobre correos (sin LLM): respuestas automáticas,
 * reenvíos, limpieza de firmas/avisos legales y texto citado.
 * El LLM refina después, pero estas señales son rápidas, explicables y testeables.
 */
import type { NormalizedEmail } from './types';

export function isAutoReply(email: Pick<NormalizedEmail, 'headers' | 'subject' | 'from'>): boolean {
  const h = email.headers;
  const autoSubmitted = h['auto-submitted'];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') return true;
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-auto-response-suppress']?.toLowerCase().includes('all')) return true;
  const precedence = h['precedence']?.toLowerCase();
  if (precedence && ['bulk', 'auto_reply', 'junk', 'list'].includes(precedence)) return true;
  if (h['list-unsubscribe'] || h['list-id']) return true;
  if (/^(mailer-daemon|postmaster|no-?reply|noreply)@/i.test(email.from.email)) return true;
  return /^(respuesta autom[aá]tica|fuera de la oficina|auto(matic)? ?reply|out of (the )?office|ausente|vacaciones)\b/i.test(
    email.subject.trim(),
  );
}

const FORWARD_SUBJECT = /^\s*(rv|fw|fwd|reenviar|reenv[ií]o)\s*:/i;
const FORWARD_MARKERS = [
  /-{3,}\s*(mensaje reenviado|forwarded message|mensaje original|original message)\s*-{3,}/i,
  /^\s*(inicio del mensaje reenviado|begin forwarded message)\s*:/im,
  /^\s*_{10,}\s*$/m, // Outlook
];

export interface ForwardedOriginal {
  fromName: string | null;
  fromEmail: string | null;
  date: string | null;
  subject: string | null;
  /** Texto del correo original (lo que escribió el cliente) */
  body: string;
  /** Texto añadido por quien reenvía (notas internas) */
  forwarderNote: string;
}

/** Detecta un reenvío y extrae remitente original y cuerpo. Devuelve null si no lo parece. */
export function detectForward(subject: string, text: string): ForwardedOriginal | null {
  const marker = FORWARD_MARKERS.map((re) => re.exec(text)).find(Boolean);
  const subjectSaysForward = FORWARD_SUBJECT.test(subject);
  if (!marker && !subjectSaysForward) return null;

  const idx = marker ? marker.index : 0;
  const forwarderNote = marker ? text.slice(0, idx).trim() : '';
  const rest = marker ? text.slice(idx + marker[0].length) : text;

  // Cabeceras del correo original: "De: Nombre <email>" / "From: ..."
  const fromLine = /^\s*\*?(de|from)\*?\s*:\s*(.+)$/im.exec(rest);
  let fromName: string | null = null;
  let fromEmail: string | null = null;
  if (fromLine) {
    const v = fromLine[2].trim();
    const angle = /^"?([^"<]*)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>/.exec(v);
    const bracket = /^(.*?)\s*\[mailto:([^\]]+)\]/i.exec(v);
    if (angle) {
      fromName = angle[1].trim() || null;
      fromEmail = angle[2].toLowerCase();
    } else if (bracket) {
      fromName = bracket[1].trim() || null;
      fromEmail = bracket[2].toLowerCase();
    } else {
      const em = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(v);
      fromEmail = em ? em[1].toLowerCase() : null;
      fromName = em ? v.replace(em[0], '').replace(/[<>"]/g, '').trim() || null : v || null;
    }
  }
  const date = /^\s*\*?(fecha|date|enviado(?: el)?|sent)\*?\s*:\s*(.+)$/im.exec(rest)?.[2].trim() ?? null;
  const subj = /^\s*\*?(asunto|subject)\*?\s*:\s*(.+)$/im.exec(rest)?.[2].trim() ?? null;

  // El cuerpo original empieza tras el bloque de cabeceras (primera línea en blanco después de "Asunto:")
  let body = rest;
  const headerEnd = /^\s*\*?(asunto|subject)\*?\s*:.*$/im.exec(rest);
  if (headerEnd) body = rest.slice(headerEnd.index + headerEnd[0].length);
  body = body.replace(/^\s*\*?(para|to|cc)\*?\s*:.*$/gim, '').trim();

  if (!fromEmail && !subjectSaysForward) return null;
  return { fromName, fromEmail, date, subject: subj, body, forwarderNote };
}

const SIGNATURE_START = [
  /^--\s*$/m,
  /^(un saludo|saludos|atentamente|un abrazo|gracias,?|best regards|regards|cordialmente)[,.!]?\s*$/im,
  /^enviado desde mi (iphone|ipad|android|m[oó]vil|samsung)/im,
  /^sent from my /im,
];

const LEGAL_NOTICE = [
  /(aviso legal|confidencialidad|este (mensaje|correo)( electr[oó]nico)? (y sus anexos )?(es|son|va dirigido|contiene)|en cumplimiento de(l| la) (reglamento|ley)|protecci[oó]n de datos|rgpd|lopd|this e-?mail (and any attachments )?(is|are) confidential)/i,
];

/**
 * Limpia el cuerpo para el LLM: quita texto citado de respuestas anteriores y avisos legales.
 * Conserva la firma (puede contener el teléfono del cliente) pero la separa al final.
 */
export function cleanBody(text: string): { main: string; signature: string } {
  let t = text.replace(/\r\n/g, '\n');
  // Citas de respuestas: "El lun, 3 nov 2026 a las 10:00, X escribió:" / "On ... wrote:"
  const quoteHeader = /^\s*(el .{5,80}(escribi[oó]|wrote)\s*:|on .{5,80}wrote\s*:)\s*$/im.exec(t);
  if (quoteHeader) t = t.slice(0, quoteHeader.index);
  t = t
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n');
  // Avisos legales: se corta desde el párrafo que los contiene
  for (const re of LEGAL_NOTICE) {
    const m = re.exec(t);
    if (m) {
      const paraStart = t.lastIndexOf('\n\n', m.index);
      t = t.slice(0, paraStart > 0 ? paraStart : m.index);
    }
  }
  let signature = '';
  for (const re of SIGNATURE_START) {
    const m = re.exec(t);
    if (m && m.index > t.length * 0.3) {
      signature = t.slice(m.index).trim();
      t = t.slice(0, m.index);
      break;
    }
  }
  return { main: t.replace(/\n{3,}/g, '\n\n').trim(), signature: signature.slice(0, 600) };
}

/** Extrae ids de mensaje de las cabeceras de hilo, en orden de relevancia. */
export function threadIds(email: Pick<NormalizedEmail, 'inReplyTo' | 'references'>): string[] {
  const ids = [...(email.inReplyTo ? [email.inReplyTo] : []), ...[...email.references].reverse()];
  return [...new Set(ids.map((i) => i.trim()).filter(Boolean))];
}
