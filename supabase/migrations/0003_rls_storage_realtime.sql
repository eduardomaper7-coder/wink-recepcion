-- =====================================================================
-- 0003: Row Level Security, Storage y Realtime
-- Modelo de acceso:
--   * service_role (servidor/agente): sin restricciones (bypass RLS).
--   * admin: lectura y escritura total, incluida configuración.
--   * arquitecto: lee todos los expedientes, edita su contenido, aprueba y envía.
--   * anon: nada.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'settings','project_code_counters','mailbox_state','staff','profiles','clients','properties',
    'project_types','required_docs_templates','checklist_templates','projects','email_threads','emails',
    'email_attachments','email_drafts','documents','facts','inconsistencies','pending_items','visit_slots',
    'agent_steps','jobs','events'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Lectura para cualquier usuario del equipo con perfil
do $$
declare t text;
begin
  foreach t in array array[
    'settings','staff','clients','properties','project_types','required_docs_templates','checklist_templates',
    'projects','email_threads','emails','email_attachments','email_drafts','documents','facts',
    'inconsistencies','pending_items','visit_slots','agent_steps','events'
  ] loop
    execute format('create policy %I on %I for select to authenticated using (public.is_staff_user())', t || '_read', t);
  end loop;
end $$;

-- Edición del contenido del expediente: admin y arquitecto
do $$
declare t text;
begin
  foreach t in array array[
    'clients','properties','projects','email_drafts','documents','facts','inconsistencies','pending_items','visit_slots'
  ] loop
    execute format('create policy %I on %I for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user())', t || '_update', t);
  end loop;
  foreach t in array array['pending_items','facts','inconsistencies','visit_slots'] loop
    execute format('create policy %I on %I for insert to authenticated with check (public.is_staff_user())', t || '_insert', t);
    execute format('create policy %I on %I for delete to authenticated using (public.is_staff_user())', t || '_delete', t);
  end loop;
end $$;

-- Configuración: solo admin
do $$
declare t text;
begin
  foreach t in array array['settings','staff','project_types','required_docs_templates','checklist_templates'] loop
    execute format('create policy %I on %I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_all', t);
  end loop;
end $$;

-- Perfiles: cada uno ve el suyo; el admin ve y gestiona todos
create policy profiles_self on profiles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy profiles_admin on profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Auditoría: el equipo puede añadir eventos propios (nunca modificar ni borrar)
create policy events_insert on events for insert to authenticated
  with check (public.is_staff_user() and actor_type = 'usuario' and actor_id = auth.uid());

-- jobs, mailbox_state y project_code_counters: solo service_role (sin políticas).

-- ---------- Storage: bucket privado ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('expedientes', 'expedientes', false, 26214400)
on conflict (id) do nothing;

create policy expedientes_read on storage.objects for select to authenticated
  using (bucket_id = 'expedientes' and public.is_staff_user());

-- ---------- Realtime ----------
alter publication supabase_realtime add table projects, agent_steps, documents, pending_items, email_drafts, emails;
