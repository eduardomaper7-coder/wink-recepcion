-- =====================================================================
-- Tareas programadas en Supabase (pg_cron + pg_net). Ejecutar UNA VEZ en el
-- SQL Editor DESPUÉS de desplegar la app en Vercel, sustituyendo los dos valores.
--
--  · Cada minuto: lee el buzón IMAP y procesa la cola (/api/cron/poll)
--  · Cada 5 minutos: red de seguridad para reintentos de la cola (/api/worker)
-- (Los recordatorios diarios los lanza Vercel Cron: ver vercel.json)
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secretos en Supabase Vault (no quedan en texto plano en la definición del cron)
select vault.create_secret('https://TU-APP.vercel.app', 'wink_app_url');
select vault.create_secret('EL_MISMO_VALOR_QUE_CRON_SECRET', 'wink_cron_secret');

create or replace function public.wink_call(p_path text) returns bigint
language sql security definer set search_path = public as $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'wink_app_url') || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'wink_cron_secret')),
    timeout_milliseconds := 30000
  );
$$;
revoke execute on function public.wink_call(text) from public, anon, authenticated;

select cron.schedule('wink-poll-mailbox', '* * * * *', $$ select public.wink_call('/api/cron/poll') $$);
select cron.schedule('wink-worker', '*/5 * * * *', $$ select public.wink_call('/api/worker') $$);

-- Para pausarlo:   select cron.unschedule('wink-poll-mailbox');
-- Para revisarlo:  select * from cron.job_run_details order by start_time desc limit 20;
