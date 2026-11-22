-- =====================================================================
-- 0002: funciones de negocio (código de expediente, cola, roles)
-- =====================================================================

-- Rol del usuario actual (usado por RLS)
create or replace function public.current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where user_id = auth.uid()
$$;

create or replace function public.is_staff_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where user_id = auth.uid())
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where user_id = auth.uid()), false)
$$;

-- Código único y atómico: WNK-2026-0042 (formato configurable en settings)
create or replace function public.next_project_code(p_year int default extract(year from now() at time zone 'Europe/Madrid')::int)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_next int;
  v_fmt text;
begin
  insert into project_code_counters (year, last_value) values (p_year, 1)
  on conflict (year) do update set last_value = project_code_counters.last_value + 1
  returning last_value into v_next;
  select project_code_format into v_fmt from settings where id;
  v_fmt := coalesce(v_fmt, 'WNK-{YYYY}-{NNNN}');
  return replace(replace(v_fmt, '{YYYY}', p_year::text), '{NNNN}', lpad(v_next::text, 4, '0'));
end $$;

-- Cola: reclamar trabajos (FOR UPDATE SKIP LOCKED, con bloqueo temporal)
create or replace function public.claim_jobs(p_limit int default 3, p_lock_seconds int default 290)
returns setof jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  update jobs j set
    status = 'en_curso',
    attempts = j.attempts + 1,
    locked_until = now() + make_interval(secs => p_lock_seconds)
  where j.id in (
    select id from jobs
    where (status = 'pendiente' and run_after <= now())
       or (status = 'en_curso' and locked_until < now()) -- trabajo abandonado (worker caído)
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning j.*;
end $$;

create or replace function public.finish_job(p_id uuid, p_ok boolean, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v jobs;
begin
  select * into v from jobs where id = p_id for update;
  if p_ok then
    update jobs set status = 'ok', locked_until = null, last_error = null where id = p_id;
  elsif v.attempts >= v.max_attempts then
    update jobs set status = 'muerto', locked_until = null, last_error = p_error where id = p_id;
  else
    -- reintento con espera exponencial: 15s, 60s, 4min…
    update jobs set status = 'pendiente', locked_until = null, last_error = p_error,
      run_after = now() + make_interval(secs => (15 * power(4, v.attempts - 1))::int)
    where id = p_id;
  end if;
end $$;

-- Solo el servidor (service_role) puede usar estas funciones
revoke execute on function public.next_project_code(int) from public, anon, authenticated;
revoke execute on function public.claim_jobs(int, int) from public, anon, authenticated;
revoke execute on function public.finish_job(uuid, boolean, text) from public, anon, authenticated;
