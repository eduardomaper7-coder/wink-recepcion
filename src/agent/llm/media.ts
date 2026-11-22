import sharp from 'sharp';

/**
 * Prepara una imagen para Claude: corrige orientación EXIF, limita el lado mayor a 1568 px
 * (menos latencia y coste, sin perder detalle útil) y la convierte a JPEG.
 * Lanza error si el formato no se puede decodificar (p. ej. HEIC sin soporte en el runtime).
 */
export async function prepareImage(buf: Buffer): Promise<{ data: Buffer; mime: string; width: number; height: number }> {
  const img = sharp(buf, { failOn: 'error' }).rotate();
  const out = await img
    .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data: out.data, mime: 'image/jpeg', width: out.info.width, height: out.info.height };
}

/** Número de páginas de un PDF (aproximado, sin dependencias). null si no se puede saber. */
export function pdfPageCount(buf: Buffer): number | null {
  const s = buf.toString('latin1');
  if (/\/Encrypt\b/.test(s)) return null;
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : null;
}

export function isEncryptedPdf(buf: Buffer): boolean {
  return /\/Encrypt\b/.test(buf.toString('latin1'));
}
