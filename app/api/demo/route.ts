import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { DEMO_CASES, injectDemoCase, type DemoCase } from '@/demo/fixtures';
import { runWorker } from '@/queue/worker';
import { pollMailbox } from '@/ingest/poll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({ action: z.enum(['inject', 'poll']), case: z.string().optional() });

/**
 * Acciones de la pantalla de demo (usuario autenticado):
 *  - inject: lanza un caso de ejemplo por el pipeline real (solo con DEMO_MODE=true)
 *  - poll: comprueba el buzón real ahora mismo (para la demo en directo)
 */
export async function POST(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: 'Petición no válida' }, { status: 400 });

  if (body.data.action === 'poll') {
    const r = await pollMailbox();
    if (r.ingested) after(() => runWorker({ budgetMs: 280_000 }));
    return NextResponse.json(r);
  }

  if (process.env.DEMO_MODE !== 'true') return NextResponse.json({ error: 'Modo demo desactivado' }, { status: 403 });
  const key = body.data.case as DemoCase;
  if (!(key in DEMO_CASES)) return NextResponse.json({ error: 'Caso desconocido' }, { status: 400 });
  try {
    const r = await injectDemoCase(key);
    after(() => runWorker({ budgetMs: 280_000 }));
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
