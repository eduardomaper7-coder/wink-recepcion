import { emailProvider } from '@/email/providers';
import { ingestEmail } from './ingest';
import { log } from '@/lib/log';

let polling: Promise<{ fetched: number; ingested: number }> | null = null;

/** Lee el buzón y guarda los correos nuevos. Evita dos lecturas simultáneas en la misma instancia. */
export async function pollMailbox(): Promise<{ fetched: number; ingested: number }> {
  if (polling) return polling;
  polling = (async () => {
    const mails = await emailProvider().fetchNew();
    let ingested = 0;
    for (const m of mails) {
      try {
        const r = await ingestEmail(m);
        if (r.emailId && !r.duplicate) ingested++;
      } catch (e) {
        log.error('Error al ingerir un correo', { error: String(e) });
      }
    }
    return { fetched: mails.length, ingested };
  })();
  try {
    return await polling;
  } finally {
    polling = null;
  }
}
