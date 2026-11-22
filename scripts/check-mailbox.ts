/** Comprueba la conexión IMAP y SMTP del buzón del agente: npm run mail:check */
import './_env';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

type MailErr = Error & { responseText?: string; response?: string; authenticationFailed?: boolean; code?: string; responseStatus?: string };

function explain(e: MailErr): string {
  const detail = [e.message, e.responseStatus, e.responseText, e.response, e.code].filter(Boolean).join(' · ');
  const auth = e.authenticationFailed || /auth|login|credential|535|invalid/i.test(detail);
  return auth ? `${detail}\n  → Usuario o contraseña rechazados: revisa MAIL_USER y MAIL_PASSWORD en .env.local (si la contraseña tiene # o espacios, ponla entre comillas: MAIL_PASSWORD="…")` : detail;
}

async function main() {
  const user = process.env.MAIL_USER || process.env.AGENT_MAILBOX!;
  const pass = process.env.MAIL_PASSWORD!;
  if (!pass) throw new Error('Falta MAIL_PASSWORD en .env.local');
  console.log(`Buzón: ${user} · contraseña de ${pass.length} caracteres`);
  let ok = true;

  const host = process.env.IMAP_HOST ?? 'imap.hostinger.com';
  const port = Number(process.env.IMAP_PORT ?? 993);
  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false });
  try {
    await client.connect();
    const folders = await client.list();
    console.log(`✓ IMAP ${host}:${port} conectado. Carpetas: ${folders.map((f) => `${f.path}${f.specialUse ? ` (${f.specialUse})` : ''}`).join(', ')}`);
    await client.logout();
  } catch (e) {
    ok = false;
    console.error(`✗ IMAP ${host}:${port}: ${explain(e as MailErr)}`);
  }

  const smtpHost = process.env.SMTP_HOST ?? 'smtp.hostinger.com';
  const smtpPort = Number(process.env.SMTP_PORT ?? 465);
  try {
    await nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user, pass } }).verify();
    console.log(`✓ SMTP ${smtpHost}:${smtpPort} verificado`);
  } catch (e) {
    ok = false;
    console.error(`✗ SMTP ${smtpHost}:${smtpPort}: ${explain(e as MailErr)}`);
  }
  if (!ok) process.exit(1);
}
main().catch((e) => {
  console.error('✗', explain(e as MailErr));
  process.exit(1);
});
