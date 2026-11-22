'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit } from '@/core/audit';
import { normalizePhone } from '@/lib/text';

type Result = { ok: true; message?: string } | { ok: false; error: string };
const ok = (message?: string): Result => {
  revalidatePath('/ajustes');
  return { ok: true, message };
};
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e instanceof Error ? e.message : String(e) });

const SettingsInput = z.object({
  project_code_format: z.string().includes('{NNNN}'),
  internal_domains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)),
  reminder_days: z.number().int().min(1).max(60),
  reminder_auto_after_first: z.boolean(),
  visit_duration_min: z.number().int().min(15).max(480),
  visit_start: z.string().regex(/^\d{2}:\d{2}$/),
  visit_end: z.string().regex(/^\d{2}:\d{2}$/),
  auto_send_internal: z.boolean(),
  duplicate_window_days: z.number().int().min(1).max(365),
  wink_signature: z.string().min(3),
  wa_reply_modes: z.object({
    cliente_nuevo: z.enum(['solo_recibir', 'borrador', 'asistente', 'solo_equipo']),
    cliente_con_expediente: z.enum(['solo_recibir', 'borrador', 'asistente', 'solo_equipo']),
    personal: z.enum(['solo_recibir', 'borrador', 'asistente', 'solo_equipo']),
  }),
});

export async function saveSettings(input: unknown): Promise<Result> {
  try {
    const u = await requireUser({ admin: true });
    const s = SettingsInput.parse(input);
    const { data: cur } = await supabaseAdmin().from('settings').select('visit_hours').single();
    await supabaseAdmin()
      .from('settings')
      .update({
        project_code_format: s.project_code_format,
        internal_domains: s.internal_domains,
        reminder_days: s.reminder_days,
        reminder_auto_after_first: s.reminder_auto_after_first,
        visit_duration_min: s.visit_duration_min,
        visit_hours: { ...(cur?.visit_hours ?? {}), start: s.visit_start, end: s.visit_end },
        auto_send_internal: s.auto_send_internal,
        duplicate_window_days: s.duplicate_window_days,
        wink_signature: s.wink_signature,
        wa_reply_modes: s.wa_reply_modes,
      })
      .eq('id', true);
    await audit('ajustes_guardados', { actorType: 'usuario', actorId: u.id });
    return ok('Ajustes guardados');
  } catch (e) {
    return fail(e);
  }
}

const StaffInput = z.object({
  id: z.string().uuid().optional(),
  full_name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['admin', 'arquitecto', '']),
  active: z.boolean(),
  phone: z.string().max(30).optional().default(''),
});

export async function saveStaff(input: unknown): Promise<Result> {
  try {
    const u = await requireUser({ admin: true });
    const s = StaffInput.parse(input);
    const phone = s.phone.trim() ? normalizePhone(s.phone) : null;
    if (s.phone.trim() && !phone) throw new Error('Teléfono no válido: usa formato +34600111222');
    const row = { full_name: s.full_name, email: s.email.toLowerCase(), role: s.role || null, active: s.active, phone };
    const { error } = s.id ? await supabaseAdmin().from('staff').update(row).eq('id', s.id) : await supabaseAdmin().from('staff').insert(row);
    if (error) throw new Error(error.code === '23505' ? 'Ese teléfono ya está asignado a otra persona' : error.message);
    await audit('personal_guardado', { actorType: 'usuario', actorId: u.id });
    return ok('Guardado');
  } catch (e) {
    return fail(e);
  }
}

const RuleSchema = z.object({ doc_type: z.string().optional(), subtype: z.string().optional(), flag: z.string().optional(), min: z.number().optional(), fact: z.string().optional() });
const ReqDocInput = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(3),
  kind: z.enum(['documento', 'dato']),
  match_rule: z.string().transform((s, ctx) => {
    try {
      return RuleSchema.parse(JSON.parse(s));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Regla JSON no válida' });
      return z.NEVER;
    }
  }),
  required: z.boolean(),
  active: z.boolean(),
  sort: z.number().int(),
});

export async function saveRequiredDoc(input: unknown): Promise<Result> {
  try {
    const u = await requireUser({ admin: true });
    const d = ReqDocInput.parse(input);
    const { data: pt } = await supabaseAdmin().from('project_types').select('id').eq('slug', 'reforma_integral_vivienda').single();
    const row = { label: d.label, kind: d.kind, match_rule: d.match_rule, required: d.required, active: d.active, sort: d.sort, project_type_id: pt!.id };
    const { error } = d.id ? await supabaseAdmin().from('required_docs_templates').update(row).eq('id', d.id) : await supabaseAdmin().from('required_docs_templates').insert(row);
    if (error) throw new Error(error.message);
    await audit('plantilla_documentos_guardada', { actorType: 'usuario', actorId: u.id });
    return ok('Guardado');
  } catch (e) {
    return fail(e);
  }
}

const CondSchema = z.object({ building_year_max: z.number().optional(), building_year_min: z.number().optional(), typology: z.array(z.string()).optional(), rooms_any: z.array(z.string()).optional() });
const ChecklistTplInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2),
  section: z.string().min(2),
  conditions: z.string().transform((s, ctx) => {
    try {
      return CondSchema.parse(JSON.parse(s || '{}'));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Condiciones JSON no válidas' });
      return z.NEVER;
    }
  }),
  items: z.string().transform((s) => s.split('\n').map((l) => l.trim()).filter(Boolean)),
  active: z.boolean(),
  sort: z.number().int(),
});

export async function saveChecklistTemplate(input: unknown): Promise<Result> {
  try {
    const u = await requireUser({ admin: true });
    const d = ChecklistTplInput.parse(input);
    if (!d.items.length) throw new Error('Añade al menos una comprobación');
    const row = { name: d.name, section: d.section, conditions: d.conditions, items: d.items, active: d.active, sort: d.sort };
    const { error } = d.id ? await supabaseAdmin().from('checklist_templates').update(row).eq('id', d.id) : await supabaseAdmin().from('checklist_templates').insert(row);
    if (error) throw new Error(error.message);
    await audit('plantilla_checklist_guardada', { actorType: 'usuario', actorId: u.id });
    return ok('Guardado');
  } catch (e) {
    return fail(e);
  }
}

const UserInput = z.object({ email: z.string().email(), password: z.string().min(10), role: z.enum(['admin', 'arquitecto']), staff_id: z.string().uuid().nullable() });

/** Alta de usuario de la aplicación (Supabase Auth) vinculado a una ficha de personal. */
export async function createAppUser(input: unknown): Promise<Result> {
  try {
    const u = await requireUser({ admin: true });
    const d = UserInput.parse(input);
    const { data, error } = await supabaseAdmin().auth.admin.createUser({ email: d.email, password: d.password, email_confirm: true });
    if (error) throw new Error(error.message);
    await supabaseAdmin().from('profiles').insert({ user_id: data.user.id, role: d.role, staff_id: d.staff_id });
    await audit('usuario_creado', { actorType: 'usuario', actorId: u.id, payload: { role: d.role } });
    return ok('Usuario creado');
  } catch (e) {
    return fail(e);
  }
}
