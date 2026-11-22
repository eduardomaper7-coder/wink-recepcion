import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { randomUUID } from 'node:crypto';
import { parseRawEmail } from '../parse';
import type { EmailProvider, NormalizedEmail, OutboundEmail, SendResult } from '../types';
import { applyDemoGuard, formatAddress } from '../outbound';
import { log } from '@/lib/log';

export interface MailboxStateStore {
  get(mailbox: string): Promise<{ uidValidity: bigint | null; lastUid: number } | null>;
  set(mailbox: string, state: { uidValidity: bigint; lastUid: number }): Promise<void>;
}

export interface ImapConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  user: string;
  password: string;
  sentFolder: string; // 'auto' o nombre exacto
  mailbox: string; // dirección del agente
  domainForIds: string;
  allowedRecipients: string;
  redirectTo: string;
  /** En la primera sincronización, cuántos días hacia atrás procesar */
  firstSyncDays?: number;
}

/**
 * Proveedor IMAP/SMTP (Hostinger u otro).
 * Recepción: lectura incremental por UID (no depende del flag \Seen, así una persona puede
 * abrir el buzón en webmail sin afectar al agente). Envío: SMTP + copia en "Enviados".
 */
export class ImapSmtpProvider implements EmailProvider {
  readonly name = 'imap';

  constructor(
    private cfg: ImapConfig,
    private state: MailboxStateStore,
  ) {}

  private client() {
    return new ImapFlow({
      host: this.cfg.imapHost,
      port: this.cfg.imapPort,
      secure: true,
      auth: { user: this.cfg.user, pass: this.cfg.password },
      logger: false,
      socketTimeout: 60_000,
    });
  }

  async fetchNew(): Promise<NormalizedEmail[]> {
    const client = this.client();
    await client.connect();
    const out: NormalizedEmail[] = [];
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const mb = client.mailbox;
        if (!mb || typeof mb === 'boolean') return [];
        const uidValidity = BigInt(mb.uidValidity);
        const saved = await this.state.get('INBOX');
        let fromUid: number;
        if (!saved || saved.uidValidity !== uidValidity) {
          // Primera vez (o buzón recreado): solo los últimos N días, para no procesar el histórico.
          const since = new Date(Date.now() - (this.cfg.firstSyncDays ?? 1) * 86_400_000);
          const uids = (await client.search({ since }, { uid: true })) || [];
          fromUid = uids.length ? Math.min(...uids) : Number(mb.uidNext);
        } else {
          fromUid = saved.lastUid + 1;
        }
        let maxUid = fromUid - 1;
        if (fromUid < Number(mb.uidNext)) {
          for await (const msg of client.fetch(`${fromUid}:*`, { uid: true, source: true }, { uid: true })) {
            if (msg.uid < fromUid || !msg.source) continue; // IMAP devuelve el último si el rango está vacío
            maxUid = Math.max(maxUid, msg.uid);
            try {
              out.push(await parseRawEmail(msg.source, this.name, `${uidValidity}:${msg.uid}`));
            } catch (e) {
              log.error('No se pudo interpretar un correo del buzón', { uid: msg.uid, error: String(e) });
            }
          }
        }
        await this.state.set('INBOX', { uidValidity, lastUid: Math.max(maxUid, saved?.lastUid ?? 0) });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  }

  async send(msg: OutboundEmail): Promise<SendResult> {
    const guarded = applyDemoGuard(msg, this.cfg.allowedRecipients, this.cfg.redirectTo);
    const messageId = `<${randomUUID()}@${this.cfg.domainForIds}>`;
    const mail = {
      from: formatAddress(guarded.msg.from),
      to: guarded.msg.to.map(formatAddress),
      cc: guarded.msg.cc?.map(formatAddress),
      subject: guarded.msg.subject,
      text: guarded.msg.text,
      html: guarded.msg.html,
      messageId,
      inReplyTo: guarded.msg.inReplyTo ?? undefined,
      references: guarded.msg.references?.length ? guarded.msg.references : undefined,
      headers: { 'X-Wink-Agent': 'recepcion-encargo' },
    };
    const transport = nodemailer.createTransport({
      host: this.cfg.smtpHost,
      port: this.cfg.smtpPort,
      secure: this.cfg.smtpPort === 465,
      auth: { user: this.cfg.user, pass: this.cfg.password },
    });
    const info = await transport.sendMail(mail);

    // Copia en "Enviados" para que el hilo completo se vea también en el webmail.
    try {
      const raw = await new MailComposer(mail).compile().build();
      await this.appendToSent(raw);
    } catch (e) {
      log.warn('Enviado, pero no se pudo guardar copia en Enviados', { error: String(e) });
    }
    return {
      providerMessageId: info.messageId ?? messageId,
      messageId,
      deliveredTo: guarded.deliveredTo,
      redirected: guarded.redirected,
    };
  }

  private async appendToSent(raw: Buffer) {
    const client = this.client();
    await client.connect();
    try {
      let folder = this.cfg.sentFolder;
      if (folder === 'auto') {
        const list = await client.list();
        folder =
          list.find((f) => f.specialUse === '\\Sent')?.path ??
          list.find((f) => /(^|\.)(sent|enviados|sent items)$/i.test(f.path))?.path ??
          'INBOX.Sent';
      }
      await client.append(folder, raw, ['\\Seen']);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}
