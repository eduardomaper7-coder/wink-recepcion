import { NextResponse, after } from 'next/server';
import { checkCronAuth } from '@/lib/auth';
import { runWorker } from '@/queue/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Procesa trabajos pendientes de la cola (reintentos incluidos) en segundo plano. */
export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  after(() => runWorker({ budgetMs: 280_000 }));
  return NextResponse.json({ ok: true });
}
