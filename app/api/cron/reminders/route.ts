import { NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/auth';
import { enqueue } from '@/queue/jobs';
import { runWorker } from '@/queue/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Una vez al día (vercel.json): prepara recordatorios de pendientes vencidos. */
export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const day = new Date().toISOString().slice(0, 10);
  await enqueue('send_reminders', {}, `reminders:${day}`);
  return NextResponse.json(await runWorker({ budgetMs: 120_000 }));
}
