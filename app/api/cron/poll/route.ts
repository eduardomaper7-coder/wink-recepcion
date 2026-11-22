import { NextResponse, after } from 'next/server';
import { checkCronAuth } from '@/lib/auth';
import { pollMailbox } from '@/ingest/poll';
import { runWorker } from '@/queue/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Lee el buzón (IMAP), guarda los correos nuevos y responde enseguida; el procesado
 * (cola) sigue en segundo plano con after(). Lo invoca pg_cron cada minuto (supabase/cron.sql).
 */
export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const poll = await pollMailbox();
  after(() => runWorker({ budgetMs: 280_000 }));
  return NextResponse.json({ poll });
}
