/** Procesa la cola desde la consola (útil en local sin cron): npm run worker */
import './_env';
import { pollMailbox } from '@/ingest/poll';
import { runWorker } from '@/queue/worker';

async function main() {
  const loop = process.argv.includes('--loop');
  do {
    const p = process.env.EMAIL_PROVIDER === 'imap' ? await pollMailbox() : { fetched: 0, ingested: 0 };
    const w = await runWorker({ budgetMs: 280_000 });
    if (p.fetched || w.processed || w.failed) console.log(new Date().toLocaleTimeString('es-ES'), { buzón: p, cola: w });
    if (loop) await new Promise((r) => setTimeout(r, 5000));
  } while (loop);
}
main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
