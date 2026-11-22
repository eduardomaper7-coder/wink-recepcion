import { createHash } from 'node:crypto';

/** "laura.martin@winkgroup.es" → "la***@winkgroup.es" */
export function maskEmail(email?: string | null): string {
  if (!email) return '-';
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 2)}***@${domain}`;
}

/** "+34 612 345 678" → "***678" */
export function maskPhone(phone?: string | null): string {
  if (!phone) return '-';
  const digits = phone.replace(/\D/g, '');
  return `***${digits.slice(-3)}`;
}

export function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}
