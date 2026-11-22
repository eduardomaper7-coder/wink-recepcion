import { supabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_LIMITS, type FileLimits } from '@/storage/files';

export interface VisitHours {
  start: string; // "09:30"
  end: string; // "18:00"
  days: number[]; // 1 = lunes … 7 = domingo
  tz: string;
  buffer_min: number;
  lookahead_days: number;
  slots_to_propose: number;
}

export interface AppSettings {
  project_code_format: string;
  internal_domains: string[];
  agent_mailbox: string;
  reminder_days: number;
  reminder_auto_after_first: boolean;
  visit_duration_min: number;
  visit_hours: VisitHours;
  file_limits: FileLimits;
  duplicate_window_days: number;
  auto_send_internal: boolean;
  wink_signature: string;
  wa_reply_modes: WaReplyModes;
}

/** Cómo responde el canal de WhatsApp según quién escribe. */
export type WaReplyMode = 'solo_recibir' | 'borrador' | 'asistente' | 'solo_equipo';
export interface WaReplyModes {
  cliente_nuevo: WaReplyMode;
  cliente_con_expediente: WaReplyMode;
  personal: WaReplyMode;
}
export const DEFAULT_WA_MODES: WaReplyModes = { cliente_nuevo: 'asistente', cliente_con_expediente: 'borrador', personal: 'solo_recibir' };

export const DEFAULT_SETTINGS: AppSettings = {
  project_code_format: 'WNK-{YYYY}-{NNNN}',
  internal_domains: ['winkgroup.es', 'aibetech.es'],
  agent_mailbox: 'prueba@aibetech.es',
  reminder_days: 5,
  reminder_auto_after_first: false,
  visit_duration_min: 90,
  visit_hours: { start: '09:30', end: '18:00', days: [1, 2, 3, 4, 5], tz: 'Europe/Madrid', buffer_min: 30, lookahead_days: 10, slots_to_propose: 3 },
  file_limits: DEFAULT_LIMITS,
  duplicate_window_days: 30,
  auto_send_internal: true,
  wink_signature: 'Un saludo,\nEquipo Wink Group\nArquitectura · Interiorismo · Construcción',
  wa_reply_modes: DEFAULT_WA_MODES,
};

export async function loadSettings(): Promise<AppSettings> {
  const { data } = await supabaseAdmin().from('settings').select('*').maybeSingle();
  const merged = { ...DEFAULT_SETTINGS, ...(data ?? {}) } as AppSettings;
  merged.wa_reply_modes = { ...DEFAULT_WA_MODES, ...(merged.wa_reply_modes ?? {}) };
  return merged;
}

export interface StaffMember {
  id: string;
  full_name: string;
  email: string;
  role: 'admin' | 'arquitecto' | null;
  active: boolean;
  phone?: string | null;
}

export async function loadStaff(): Promise<StaffMember[]> {
  const { data } = await supabaseAdmin().from('staff').select('id,full_name,email,role,active,phone').eq('active', true);
  return (data ?? []) as StaffMember[];
}
