-- =====================================================================
-- 0004: endurecimiento (avisos del linter de seguridad de Supabase)
-- Las funciones auxiliares de RLS solo las necesita el rol authenticated.
-- jobs, mailbox_state y project_code_counters no tienen políticas a propósito:
-- solo el servidor (service_role) accede a ellas.
-- =====================================================================
revoke execute on function public.current_app_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_staff_user() from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff_user() to authenticated;
