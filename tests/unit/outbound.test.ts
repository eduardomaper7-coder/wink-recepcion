import { describe, expect, it } from 'vitest';
import { applyDemoGuard } from '@/email/outbound';

const msg = { from: { email: 'prueba@aibetech.es' }, to: [{ email: 'lucia.ficticia@gmail.com' }], cc: [{ email: 'eduardo@aibetech.es' }], subject: 'Documentación', text: 'x' };

describe('protección de envíos en la demo', () => {
  it('sin lista permitida no toca nada', () => expect(applyDemoGuard(msg, '', '').redirected).toBe(false));
  it('redirige destinatarios no permitidos y lo indica en el asunto', () => {
    const r = applyDemoGuard(msg, '@aibetech.es', 'eduardo@aibetech.es');
    expect(r.redirected).toBe(true);
    expect(r.msg.to.map((a) => a.email)).toEqual(['eduardo@aibetech.es']);
    expect(r.msg.subject).toContain('lucia.ficticia@gmail.com');
  });
});
