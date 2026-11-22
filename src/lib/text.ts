/** Utilidades de texto puras (sin dependencias del servidor). */

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** "Baño principal – estado" → "bano-principal-estado" */
export function slugify(s: string, max = 40): string {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

const STREET_ABBR: Record<string, string> = {
  'c/': 'calle ',
  'c.': 'calle ',
  'cl ': 'calle ',
  'avda.': 'avenida ',
  'avda ': 'avenida ',
  'av.': 'avenida ',
  'pº': 'paseo ',
  'p.º': 'paseo ',
  'pza.': 'plaza ',
  'pl.': 'plaza ',
};

/** Normaliza una dirección para comparar ("C/ Ibiza, 23 - 3ºB" ≈ "calle ibiza 23 3 b"). */
export function normalizeAddress(addr?: string | null): string | null {
  if (!addr) return null;
  let s = ` ${addr.toLowerCase()} `;
  for (const [k, v] of Object.entries(STREET_ABBR)) s = s.split(` ${k}`).join(` ${v}`);
  s = stripAccents(s)
    .replace(/[ºª]/g, ' ')
    .replace(/\b(planta|piso|puerta|pta|esc|escalera|madrid|espana)\b/g, ' ')
    .replace(/\b\d{5}\b/g, ' ') // código postal fuera
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

export function normalizeEmail(e?: string | null): string | null {
  if (!e) return null;
  const v = e.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
}

/** Teléfono español a E.164 cuando es posible. */
export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/[^\d+]/g, '');
  if (/^\+\d{9,15}$/.test(digits)) return digits;
  if (/^0034\d{9}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^34\d{9}$/.test(digits)) return `+${digits}`;
  if (/^[6789]\d{8}$/.test(digits)) return `+34${digits}`;
  return null;
}

/** Quita prefijos de respuesta/reenvío del asunto. */
export function normalizeSubject(s?: string | null): string {
  return (s ?? '')
    .replace(/^\s*((re|rv|fw|fwd|reenviar|resp|r)\s*:\s*)+/gi, '')
    .trim()
    .toLowerCase();
}

export function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function fileExtension(filename: string, mime?: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(filename);
  if (m) return m[1].toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Número a partir de texto en formato español: "82,40 m²" → 82.4 · "1.250,5" → 1250.5 · "1962" → 1962 · "82.4" → 82.4
 * El punto solo se trata como separador de miles si va seguido de grupos exactos de 3 cifras.
 */
export function parseSpanishNumber(v?: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /-?\d[\d.]*(?:,\d+)?/.exec(v);
  if (!m) return null;
  let s = m[0].replace(/\.$/, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function formatDateEs(d: Date | string, withTime = true): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

/** Anotaciones de trabajo que nunca deben ver los clientes: "(según correo…)", "(no consta en la foto)", "(fuente: …)" */
const INTERNAL_NOTE_RE = /\s*\((?=[^)]*\b(seg[uú]n|no consta|no verificad|sin verificar|no confirmad|contexto del encargo|fuente|nota interna|interno|r[oó]tulo del plano)\b)[^)]*\)/gi;

/** Limpia un valor antes de usarlo en un texto para el cliente. */
export function clientSafe(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  return value.replace(INTERNAL_NOTE_RE, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([,.;:])/g, '$1').trim();
}

export function hasInternalNote(text: string): string | null {
  const m = new RegExp(INTERNAL_NOTE_RE.source, 'i').exec(text);
  return m ? m[0].trim() : null;
}
