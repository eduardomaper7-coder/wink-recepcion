/**
 * Detección de encargos duplicados que llegan por dos vías (cliente y personal de Wink).
 * Puntuación explicable: cada coincidencia suma y queda registrada como motivo.
 */
import { normalizeAddress, normalizeEmail, normalizePhone } from '@/lib/text';

export interface DedupeCandidate {
  projectId: string;
  code: string;
  createdAt: string;
  status: string;
  clientEmail: string | null;
  clientPhone: string | null;
  address: string | null;
  cadastralRef: string | null;
}

export interface DedupeInput {
  clientEmail: string | null;
  clientPhone: string | null;
  address: string | null;
  cadastralRef: string | null;
}

export interface DedupeMatch {
  candidate: DedupeCandidate;
  score: number;
  reasons: string[];
  decision: 'fusionar' | 'revisar';
}

export const MERGE_THRESHOLD = 0.6;
export const REVIEW_THRESHOLD = 0.4;

function addressesMatch(a: string | null, b: string | null): boolean {
  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Coincidencia de calle + número (los primeros tokens hasta el primer número inclusive)
  const key = (s: string) => {
    const m = /^(.*?\d+)/.exec(s);
    return m ? m[1] : s;
  };
  return key(na) === key(nb) && key(na).length > 6;
}

export function scoreDuplicate(input: DedupeInput, c: DedupeCandidate): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const e1 = normalizeEmail(input.clientEmail);
  const e2 = normalizeEmail(c.clientEmail);
  if (e1 && e2 && e1 === e2) {
    score += 0.6;
    reasons.push('mismo email del cliente');
  }
  const p1 = normalizePhone(input.clientPhone);
  const p2 = normalizePhone(c.clientPhone);
  if (p1 && p2 && p1 === p2) {
    score += 0.4;
    reasons.push('mismo teléfono');
  }
  const r1 = input.cadastralRef?.replace(/\s/g, '').toUpperCase();
  const r2 = c.cadastralRef?.replace(/\s/g, '').toUpperCase();
  if (r1 && r2 && r1.replace(/[^0-9A-Z]/g, '').slice(0, 18) === r2.replace(/[^0-9A-Z]/g, '').slice(0, 18)) {
    score += 0.6;
    reasons.push('misma referencia catastral');
  }
  if (addressesMatch(input.address, c.address)) {
    score += 0.5;
    reasons.push('misma dirección');
  }
  return { score: Math.min(score, 1), reasons };
}

export function findDuplicate(input: DedupeInput, candidates: DedupeCandidate[], now: Date, windowDays: number): DedupeMatch | null {
  const minDate = now.getTime() - windowDays * 86_400_000;
  let best: DedupeMatch | null = null;
  for (const c of candidates) {
    if (['archivado'].includes(c.status)) continue;
    if (new Date(c.createdAt).getTime() < minDate) continue;
    const { score, reasons } = scoreDuplicate(input, c);
    if (score < REVIEW_THRESHOLD) continue;
    if (!best || score > best.score) {
      best = { candidate: c, score, reasons, decision: score >= MERGE_THRESHOLD ? 'fusionar' : 'revisar' };
    }
  }
  return best;
}
