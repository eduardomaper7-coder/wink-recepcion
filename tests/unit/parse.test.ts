import { describe, expect, it } from 'vitest';
import MailComposer from 'nodemailer/lib/mail-composer';
import { parseRawEmail } from '@/email/parse';

describe('parseRawEmail', () => {
  it('normaliza remitente, hilo y adjuntos', async () => {
    const raw = await new MailComposer({
      from: '"Lucía Fernández" <lucia@gmail.com>',
      to: 'prueba@aibetech.es',
      subject: 'Re: Documentación',
      text: 'Adjunto la nota simple',
      messageId: '<abc@gmail.com>',
      inReplyTo: '<prev@aibetech.es>',
      references: ['<root@aibetech.es>', '<prev@aibetech.es>'],
      attachments: [{ filename: 'nota.pdf', content: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }],
    }).compile().build();
    const e = await parseRawEmail(raw, 'test', '1');
    expect(e.from).toEqual({ email: 'lucia@gmail.com', name: 'Lucía Fernández' });
    expect(e.messageId).toBe('<abc@gmail.com>');
    expect(e.inReplyTo).toBe('<prev@aibetech.es>');
    expect(e.references).toEqual(['<root@aibetech.es>', '<prev@aibetech.es>']);
    expect(e.attachments[0].filename).toBe('nota.pdf');
  });
});
