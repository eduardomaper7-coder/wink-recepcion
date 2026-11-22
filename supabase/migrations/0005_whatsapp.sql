-- =====================================================================
-- 0005: integración con la app de WhatsApp de Wink (dos apps conectadas)
-- =====================================================================
alter type project_origin add value if not exists 'whatsapp';

-- Personal: móvil para reconocerle cuando escribe por WhatsApp (E.164, p. ej. +34600111222)
alter table staff add column if not exists phone text;
create unique index if not exists staff_phone_uq on staff (phone) where phone is not null;

-- Canal de cada mensaje (correo o WhatsApp) y datos del remitente por WhatsApp
alter table emails add column if not exists channel text not null default 'email' check (channel in ('email', 'whatsapp'));
alter table emails add column if not exists from_phone text;
alter table emails add column if not exists wa_conversation_id text;
create index if not exists emails_wa_conv_idx on emails (wa_conversation_id) where wa_conversation_id is not null;

-- Borradores: por qué canal salen
alter table email_drafts add column if not exists channel text not null default 'email' check (channel in ('email', 'whatsapp'));
alter table email_drafts add column if not exists wa_conversation_id text;

-- Expediente ↔ conversación de WhatsApp y modo de respuesta propio (null = el de Ajustes)
alter table projects add column if not exists wa_conversation_id text;
alter table projects add column if not exists wa_reply_mode text check (wa_reply_mode in ('solo_recibir', 'borrador', 'asistente', 'solo_equipo'));
create index if not exists projects_wa_conv_idx on projects (wa_conversation_id) where wa_conversation_id is not null;

-- Clientes: búsqueda por teléfono
create index if not exists clients_phone_idx on clients (phone) where phone is not null;

-- Modos de respuesta por WhatsApp por defecto, según quién escribe
alter table settings add column if not exists wa_reply_modes jsonb not null
  default '{"cliente_nuevo":"asistente","cliente_con_expediente":"borrador","personal":"solo_recibir"}';

-- Borradores de respuesta al cliente (p. ej. por WhatsApp en modo «Borrador con aprobación»)
alter type draft_kind add value if not exists 'respuesta';
