import type { Address, OutboundEmail } from './types';

export function formatAddress(a: Address): string {
  if (!a.name) return a.email;
  const safe = a.name.replace(/"/g, '');
  return `"${safe}" <${a.email}>`;
}

function allowed(email: string, patterns: string[]): boolean {
  const e = email.toLowerCase();
  return patterns.some((p) => (p.startsWith('@') ? e.endsWith(p) : e === p));
}

/**
 * Protección para la demo: si DEMO_ALLOWED_RECIPIENTS tiene valor, cualquier destinatario
 * fuera de la lista se sustituye por DEMO_REDIRECT_TO (y se indica en el asunto).
 * Evita escribir a las direcciones ficticias de los casos de ejemplo.
 */
export function applyDemoGuard(
  msg: OutboundEmail,
  allowedRecipients: string,
  redirectTo: string,
): { msg: OutboundEmail; deliveredTo: string[]; redirected: boolean } {
  const patterns = allowedRecipients
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const all = [...msg.to, ...(msg.cc ?? [])].map((a) => a.email);
  if (!patterns.length) return { msg, deliveredTo: all, redirected: false };

  const blocked = all.filter((e) => !allowed(e, patterns));
  if (!blocked.length) return { msg, deliveredTo: all, redirected: false };
  if (!redirectTo) throw new Error('Destinatario no permitido en modo demo y DEMO_REDIRECT_TO vacío');

  const keep = (list: Address[]) => list.filter((a) => allowed(a.email, patterns));
  let to = keep(msg.to);
  if (!to.length) to = [{ email: redirectTo, name: 'Demo (redirigido)' }];
  const cc = keep(msg.cc ?? []);
  const out: OutboundEmail = {
    ...msg,
    to,
    cc,
    subject: `[DEMO → ${blocked.join(', ')}] ${msg.subject}`,
  };
  return { msg: out, deliveredTo: [...to, ...cc].map((a) => a.email), redirected: true };
}
