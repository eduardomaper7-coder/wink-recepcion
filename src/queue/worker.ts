import { claimJobs, finishJob } from './jobs';
import { processEmail } from '@/agent/pipeline';
import { createDueReminders } from '@/agent/reminders';
import { log } from '@/lib/log';

/**
 * Procesa trabajos de la cola hasta agotar el presupuesto de tiempo.
 * Los fallos se reintentan con espera exponencial (finish_job) y, tras el máximo,
 * el trabajo queda "muerto" y visible en /bandeja.
 */
export async function runWorker(opts: { budgetMs?: number; concurrency?: number } = {}) {
  const budget = opts.budgetMs ?? 240_000;
  const started = Date.now();
  let processed = 0;
  let failed = 0;
  while (Date.now() - started < budget) {
    const jobs = await claimJobs(opts.concurrency ?? 3);
    if (!jobs.length) break;
    await Promise.all(
      jobs.map(async (job) => {
        try {
          if (job.type === 'process_email') await processEmail(String(job.payload.emailId));
          else if (job.type === 'send_reminders') await createDueReminders();
          else throw new Error(`Tipo de trabajo desconocido: ${job.type}`);
          await finishJob(job.id, true);
          processed++;
        } catch (e) {
          failed++;
          const msg = e instanceof Error ? e.message : String(e);
          log.error('Trabajo fallido', { jobId: job.id, type: job.type, attempt: job.attempts, error: msg });
          await finishJob(job.id, false, msg.slice(0, 1000));
        }
      }),
    );
  }
  return { processed, failed, ms: Date.now() - started };
}
