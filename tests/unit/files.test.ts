import { describe, expect, it } from 'vitest';
import { checkAttachment, DEFAULT_LIMITS, safeFilename, sniffMime } from '@/storage/files';

const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);

describe('validación de adjuntos', () => {
  it('reconoce el tipo real por la firma binaria', () => {
    expect(sniffMime(pdf)).toBe('application/pdf');
    expect(sniffMime(jpg)).toBe('image/jpeg');
  });
  it('un ejecutable disfrazado de PDF se rechaza', () => {
    const r = checkAttachment({ filename: 'nota_simple.pdf', contentType: 'application/pdf', size: exe.length, content: exe }, DEFAULT_LIMITS);
    expect(r.accepted).toBe(false);
  });
  it('un .docx/.zip se rechaza pidiendo PDF', () => {
    const r = checkAttachment({ filename: 'x.docx', contentType: 'application/vnd.openxmlformats', size: zip.length, content: zip }, DEFAULT_LIMITS);
    expect(r.reason).toMatch(/PDF/);
  });
  it('rechaza archivos demasiado grandes', () => {
    const r = checkAttachment({ filename: 'a.pdf', contentType: 'application/pdf', size: 30 * 1024 * 1024, content: pdf }, DEFAULT_LIMITS);
    expect(r.accepted).toBe(false);
  });
  it('nombres seguros para Storage', () => expect(safeFilename('../../Fotos/Baño principal (1).JPG')).toBe('Bano_principal_1_.JPG'));
});
