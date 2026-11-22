/**
 * Inyecta un caso de demo por el pipeline real y lo procesa en esta misma consola.
 *   npm run demo:load            → caso 1 (reenvío de Laura)
 *   npm run demo:load -- caso2   → caso 2 (cliente directo)
 *   npm run demo:load -- all     → casos 1, 2, 2b (duplicado), 3 y 4
 */
import './_env';
import { DEMO_CASES, injectDemoCase, type DemoCase } from '@/demo/fixtures';
import { runWorker } from '@/queue/worker';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function run(key: DemoCase) {
  const t0 = Date.now();
  console.log(`\n▶ ${DEMO_CASES[key].label}`);
  const r = await injectDemoCase(key);
  if (!r.emailId) return console.log('  (omitido)');
  await runWorker({ budgetMs: 280_000, concurrency: 1 });
  const { data: steps } = await supabaseAdmin().from('agent_steps').select('task_no,label,status,detail').eq('email_id', r.emailId).order('task_no');
  for (const s of steps ?? []) console.log(`  ${s.status === 'ok' ? '✓' : s.status === 'omitido' ? '–' : '✗'} ${s.task_no}. ${s.label}: ${s.detail ?? s.status}`);
  const { data: e } = await supabaseAdmin().from('emails').select('processing_status,processing_error,projects(code,status)').eq('id', r.emailId).single();
  console.log(`  → ${e?.processing_status}${e?.processing_error ? ` (${e.processing_error})` : ''} · ${JSON.stringify(e?.projects ?? null)} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

async function main() {
  if (process.env.DEMO_MODE !== 'true') throw new Error('DEMO_MODE=true es obligatorio para cargar casos de demo');
  const arg = process.argv[2] ?? 'caso1';
  const keys: DemoCase[] = arg === 'all' ? ['caso1', 'caso2', 'caso2_duplicado', 'caso3', 'caso4'] : [arg as DemoCase];
  for (const k of keys) {
    if (!(k in DEMO_CASES)) throw new Error(`Caso desconocido: ${k}. Opciones: ${Object.keys(DEMO_CASES).join(', ')}, all`);
    await run(k);
  }
}
main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
