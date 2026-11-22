/** Validación de adjuntos: tipo real por firma binaria (no por extensión) y límites de tamaño. */

export interface FileLimits {
  max_file_mb: number;
  max_total_mb: number;
  max_files: number;
  allowed: string[];
}

export const DEFAULT_LIMITS: FileLimits = {
  max_file_mb: 25,
  max_total_mb: 60,
  max_files: 30,
  allowed: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
};

/** Detecta el tipo por los primeros bytes. Devuelve null si no es un tipo conocido. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip'; // zip / docx / xlsx
  if (buf.subarray(0, 2).toString('latin1') === 'MZ') return 'application/x-msdownload';
  return null;
}

export interface AttachmentCheck {
  accepted: boolean;
  mime: string;
  reason?: string;
}

export function checkAttachment(
  file: { filename: string; contentType: string; size: number; content: Buffer },
  limits: FileLimits,
): AttachmentCheck {
  const sniffed = sniffMime(file.content);
  const mime = sniffed ?? file.contentType;
  if (file.size > limits.max_file_mb * 1024 * 1024) {
    return { accepted: false, mime, reason: `Supera el tamaño máximo de ${limits.max_file_mb} MB` };
  }
  if (!sniffed) return { accepted: false, mime, reason: 'Formato no admitido o no reconocible' };
  if (!limits.allowed.includes(sniffed)) {
    const hint = sniffed === 'application/zip' ? ' (comprimidos y documentos de Office: enviar en PDF)' : '';
    return { accepted: false, mime, reason: `Tipo de archivo no admitido: ${sniffed}${hint}` };
  }
  return { accepted: true, mime: sniffed };
}

/** Nombre seguro para Storage (sin rutas, sin caracteres raros). */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'archivo';
  return (
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .slice(-120) || 'archivo'
  );
}

export const PROJECT_FOLDERS = ['01_Cliente', '02_Fotografias', '03_Planos', '04_Documentacion_legal', '05_Otros'] as const;
export type ProjectFolder = (typeof PROJECT_FOLDERS)[number];

export function folderForDocType(t: string): ProjectFolder {
  switch (t) {
    case 'foto':
      return '02_Fotografias';
    case 'plano':
      return '03_Planos';
    case 'nota_simple':
    case 'certificado':
    case 'contrato':
      return '04_Documentacion_legal';
    default:
      return '05_Otros';
  }
}
