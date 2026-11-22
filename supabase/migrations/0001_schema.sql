-- =====================================================================
-- Agente de Recepción del Encargo — Wink Group
-- 0001: esquema principal
-- =====================================================================
create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------- Tipos enumerados ----------
create type app_role as enum ('admin', 'arquitecto');
create type project_status as enum (
  'procesando',
  'esperando_datos_internos',
  'pendiente_revision',
  'esperando_cliente',
  'listo_para_visita',
  'visita_agendada',
  'archivado'
);
create type project_origin as enum ('cliente_directo', 'reenvio_personal', 'encargo_personal', 'cc_personal');
create type email_direction as enum ('entrante', 'saliente');
create type sender_type as enum ('cliente', 'personal', 'sistema', 'desconocido');
create type email_classification as enum ('encargo', 'respuesta', 'confirmacion_visita', 'auto_respuesta', 'no_encargo', 'sin_clasificar');
create type email_processing as enum ('recibido', 'procesando', 'procesado', 'ignorado', 'error');
create type doc_type as enum ('foto', 'plano', 'nota_simple', 'certificado', 'contrato', 'otro');
create type doc_status as enum ('ok', 'ilegible', 'duplicado', 'rechazado');
create type pending_status as enum ('pendiente', 'pedido', 'recibido', 'descartado');
create type draft_kind as enum ('pendientes_y_visita', 'recordatorio', 'solicitud_interna', 'aviso_interno', 'confirmacion_visita');
create type draft_status as enum ('borrador', 'aprobado', 'enviado', 'descartado', 'error');
create type slot_status as enum ('propuesto', 'confirmado', 'descartado');
create type step_status as enum ('pendiente', 'en_curso', 'ok', 'error', 'omitido');
create type job_status as enum ('pendiente', 'en_curso', 'ok', 'error', 'muerto');
create type actor_type as enum ('agente', 'usuario', 'sistema');

-- ---------- Configuración ----------
create table settings (
  id boolean primary key default true check (id), -- fila única
  project_code_format text not null default 'WNK-{YYYY}-{NNNN}',
  internal_domains text[] not null default '{}',
  agent_mailbox citext not null,
  reminder_days int not null default 5,
  reminder_auto_after_first boolean not null default false,
  visit_duration_min int not null default 90,
  visit_hours jsonb not null default '{"start":"09:30","end":"18:00","days":[1,2,3,4,5],"tz":"Europe/Madrid","buffer_min":30,"lookahead_days":10,"slots_to_propose":3}',
  file_limits jsonb not null default '{"max_file_mb":25,"max_total_mb":60,"max_files":30,"allowed":["application/pdf","image/jpeg","image/png","image/webp","image/heic","image/heif"]}',
  duplicate_window_days int not null default 30,
  auto_send_internal boolean not null default true,
  wink_signature text not null default E'Un saludo,\nEquipo Wink Group\nArquitectura · Interiorismo · Construcción',
  updated_at timestamptz not null default now()
);

create table project_code_counters (
  year int primary key,
  last_value int not null default 0
);

create table mailbox_state (
  mailbox text primary key,
  uid_validity bigint,
  last_uid bigint not null default 0,
  last_poll_at timestamptz
);

-- ---------- Personas ----------
create table staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email citext not null unique,
  role app_role, -- null: personal sin acceso a la app (solo remitente interno)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  staff_id uuid references staff(id) on delete set null,
  role app_role not null default 'arquitecto',
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email citext unique,
  phone text,
  consent_status text not null default 'pendiente' check (consent_status in ('pendiente', 'otorgado', 'revocado')),
  consent_at timestamptz,
  consent_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  address text,
  address_norm text,
  postal_code text,
  city text,
  cadastral_ref text,
  registry_finca text,
  surface_m2 numeric,
  floor text,
  typology text,
  building_year int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on properties (address_norm);
create index on properties (cadastral_ref);

-- ---------- Plantillas ----------
create table project_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null
);

create table required_docs_templates (
  id uuid primary key default gen_random_uuid(),
  project_type_id uuid not null references project_types(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('documento', 'dato')),
  -- regla de cumplimiento: {"doc_type":"nota_simple"} | {"fact":"client.phone"} | {"doc_type":"plano","flag":"es_estado_actual"}
  match_rule jsonb not null,
  required boolean not null default true,
  audience text not null default 'cliente' check (audience in ('cliente', 'interno')),
  sort int not null default 0,
  active boolean not null default true
);

create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- condiciones: {"building_year_max":1960} | {"typology":["piso"]} | {"rooms_any":["cocina"]} | {} (siempre)
  conditions jsonb not null default '{}',
  section text not null,
  items text[] not null,
  sort int not null default 0,
  active boolean not null default true
);

-- ---------- Expedientes ----------
create table projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  client_id uuid references clients(id),
  property_id uuid references properties(id),
  project_type_id uuid references project_types(id),
  responsible_staff_id uuid references staff(id),
  origin project_origin not null,
  origin_staff_id uuid references staff(id),
  status project_status not null default 'procesando',
  title text,
  internal_context text, -- notas del personal: NUNCA se copian al cliente
  briefing jsonb,
  briefing_md text,
  scope jsonb,
  scope_md text,
  checklist jsonb,
  visit_at timestamptz,
  visit_event_id text,
  merged_into_id uuid references projects(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  received_at timestamptz not null default now(),
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on projects (status);
create index on projects (responsible_staff_id);
create index on projects (client_id);

-- ---------- Correo ----------
create table email_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  root_message_id text,
  subject_norm text,
  created_at timestamptz not null default now()
);
create index on email_threads (project_id);

create table emails (
  id uuid primary key default gen_random_uuid(),
  direction email_direction not null,
  provider text not null,
  provider_message_id text,
  message_id_header text,
  in_reply_to text,
  references_ids text[] not null default '{}',
  thread_id uuid references email_threads(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  from_email citext,
  from_name text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  headers jsonb not null default '{}',
  sender_type sender_type not null default 'desconocido',
  classification email_classification not null default 'sin_clasificar',
  processing_status email_processing not null default 'recibido',
  processing_error text,
  forwarded_original jsonb,
  analysis jsonb,
  approved_by uuid references auth.users(id),
  raw_storage_path text,
  created_at timestamptz not null default now()
);
create unique index emails_provider_msg_uq on emails (provider, provider_message_id) where provider_message_id is not null;
create unique index emails_msgid_dir_uq on emails (message_id_header, direction) where message_id_header is not null;
create index on emails (project_id);
create index on emails (thread_id);
create index on emails (classification, processing_status);

create table email_attachments (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references emails(id) on delete cascade,
  filename text not null,
  content_type text not null,
  size_bytes int not null,
  sha256 text not null,
  storage_path text,
  accepted boolean not null default true,
  reject_reason text,
  created_at timestamptz not null default now()
);
create index on email_attachments (email_id);

create table email_drafts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind draft_kind not null,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text not null,
  body_text text not null,
  in_reply_to_email_id uuid references emails(id),
  status draft_status not null default 'borrador',
  requires_approval boolean not null default true,
  compliance_flags text[] not null default '{}',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  sent_email_id uuid references emails(id),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on email_drafts (project_id, status);

-- ---------- Documentos y datos ----------
create table documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  email_id uuid references emails(id) on delete set null,
  attachment_id uuid references email_attachments(id) on delete set null,
  doc_type doc_type not null default 'otro',
  original_name text not null,
  new_name text,
  folder text not null,
  storage_path text not null,
  mime text not null,
  size_bytes int not null,
  sha256 text not null,
  page_count int,
  description text,
  extracted jsonb not null default '{}',
  status doc_status not null default 'ok',
  duplicate_of uuid references documents(id) on delete set null,
  classified_by text not null default 'agente' check (classified_by in ('agente', 'usuario')),
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on documents (project_id);
create index on documents (project_id, sha256);

create table facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  field text not null,          -- p. ej. property.surface_m2, client.phone, request.budget
  value text not null,
  value_num numeric,
  source_type text not null check (source_type in ('email', 'document', 'usuario')),
  source_id uuid,
  source_label text,            -- texto legible: "Nota simple (pág. 1)" / "Correo de Laura 20/11"
  page int,
  confidence numeric,
  is_internal boolean not null default false, -- sale de notas del personal
  created_at timestamptz not null default now()
);
create index on facts (project_id, field);

create table inconsistencies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  field text,
  description text not null,
  fact_ids uuid[] not null default '{}',
  origin text not null default 'agente',
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table pending_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  description text not null,
  status pending_status not null default 'pendiente',
  source text not null default 'auto' check (source in ('auto', 'manual', 'agente')),
  template_id uuid references required_docs_templates(id) on delete set null,
  audience text not null default 'cliente' check (audience in ('cliente', 'interno')),
  resolved_by_document_id uuid references documents(id) on delete set null,
  requested_at timestamptz,
  received_at timestamptz,
  reminder_count int not null default 0,
  last_reminder_at timestamptz,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on pending_items (project_id, status);

create table visit_slots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status slot_status not null default 'propuesto',
  calendar_event_id text,
  created_at timestamptz not null default now()
);

-- ---------- Ejecución del agente ----------
create table agent_steps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  email_id uuid not null references emails(id) on delete cascade,
  step text not null,       -- t0_triage, t1_expediente, t2_documentos, t3_briefing, t4_pendientes, t5_alcance, t6_visita
  task_no int not null,     -- 0..6 (pantalla de demo)
  label text not null,
  status step_status not null default 'pendiente',
  detail text,
  output jsonb,
  model text,
  input_tokens int,
  output_tokens int,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  unique (email_id, step)
);
create index on agent_steps (project_id);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  dedupe_key text unique,
  status job_status not null default 'pendiente',
  attempts int not null default 0,
  max_attempts int not null default 4,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on jobs (status, run_after);

create table events (
  id bigint generated always as identity primary key,
  project_id uuid references projects(id) on delete cascade,
  actor_type actor_type not null,
  actor_id uuid,
  action text not null,
  payload jsonb not null default '{}', -- sin datos personales completos
  created_at timestamptz not null default now()
);
create index on events (project_id, created_at desc);

-- updated_at automático
create or replace function touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['clients','properties','projects','email_drafts','documents','pending_items','jobs','settings'] loop
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;
