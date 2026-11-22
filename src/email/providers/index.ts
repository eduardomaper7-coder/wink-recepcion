import { env } from '@/config/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { EmailProvider } from '../types';
import { FixtureProvider } from './fixture';
import { ImapSmtpProvider, type MailboxStateStore } from './imap';

/**
 * Punto único de selección de proveedor. Para añadir Gmail API o Microsoft Graph basta con
 * implementar EmailProvider (fetchNew/send) y registrarlo aquí; el agente no cambia.
 */
const dbState: MailboxStateStore = {
  async get(mailbox) {
    const { data } = await supabaseAdmin()
      .from('mailbox_state')
      .select('uid_validity,last_uid')
      .eq('mailbox', `${env().AGENT_MAILBOX}:${mailbox}`)
      .maybeSingle();
    return data ? { uidValidity: data.uid_validity ? BigInt(data.uid_validity) : null, lastUid: Number(data.last_uid) } : null;
  },
  async set(mailbox, s) {
    await supabaseAdmin()
      .from('mailbox_state')
      .upsert({
        mailbox: `${env().AGENT_MAILBOX}:${mailbox}`,
        uid_validity: s.uidValidity.toString(),
        last_uid: s.lastUid,
        last_poll_at: new Date().toISOString(),
      });
  },
};

let instance: EmailProvider | null = null;

export function emailProvider(): EmailProvider {
  if (instance) return instance;
  const e = env();
  const domain = e.AGENT_MAILBOX.split('@')[1];
  if (e.EMAIL_PROVIDER === 'imap') {
    if (!e.MAIL_PASSWORD) throw new Error('EMAIL_PROVIDER=imap requiere MAIL_USER y MAIL_PASSWORD');
    instance = new ImapSmtpProvider(
      {
        imapHost: e.IMAP_HOST,
        imapPort: e.IMAP_PORT,
        smtpHost: e.SMTP_HOST,
        smtpPort: e.SMTP_PORT,
        user: e.MAIL_USER || e.AGENT_MAILBOX,
        password: e.MAIL_PASSWORD,
        sentFolder: e.IMAP_SENT_FOLDER,
        mailbox: e.AGENT_MAILBOX,
        domainForIds: domain,
        allowedRecipients: e.DEMO_ALLOWED_RECIPIENTS,
        redirectTo: e.DEMO_REDIRECT_TO,
      },
      dbState,
    );
  } else {
    instance = new FixtureProvider(domain);
  }
  return instance;
}
