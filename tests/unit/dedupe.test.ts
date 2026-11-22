import { describe, expect, it } from 'vitest';
import { findDuplicate, type DedupeCandidate } from '@/agent/dedupe';

const now = new Date('2026-11-20T10:00:00Z');
const cand = (o: Partial<DedupeCandidate>): DedupeCandidate => ({
  projectId: 'p1', code: 'WNK-2026-0001', createdAt: '2026-11-19T10:00:00Z', status: 'pendiente_revision',
  clientEmail: null, clientPhone: null, address: null, cadastralRef: null, ...o,
});

describe('findDuplicate — mismo encargo por dos vías', () => {
  it('fusiona si coincide el email del cliente', () => {
    const m = findDuplicate({ clientEmail: 'LUCIA@gmail.com', clientPhone: null, address: null, cadastralRef: null }, [cand({ clientEmail: 'lucia@gmail.com' })], now, 30);
    expect(m?.decision).toBe('fusionar');
    expect(m?.reasons).toContain('mismo email del cliente');
  });

  it('solo la dirección (escrita distinto) → revisión manual', () => {
    const m = findDuplicate({ clientEmail: 'otro@x.com', clientPhone: null, address: 'C/ Ibiza, 23 - 3ºB, Madrid', cadastralRef: null }, [cand({ address: 'Calle Ibiza 23, 3 B' })], now, 30);
    expect(m?.decision).toBe('revisar');
  });

  it('teléfono + dirección → fusionar', () => {
    const m = findDuplicate({ clientEmail: null, clientPhone: '612 345 678', address: 'calle Ibiza 23', cadastralRef: null }, [cand({ clientPhone: '+34612345678', address: 'C/ Ibiza 23' })], now, 30);
    expect(m?.decision).toBe('fusionar');
  });

  it('fuera de la ventana de días no se considera', () => {
    const m = findDuplicate({ clientEmail: 'lucia@gmail.com', clientPhone: null, address: null, cadastralRef: null }, [cand({ clientEmail: 'lucia@gmail.com', createdAt: '2026-09-01T00:00:00Z' })], now, 30);
    expect(m).toBeNull();
  });
});
