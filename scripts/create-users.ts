/**
 * Crea los usuarios de la aplicación para la demo:
 *   npm run setup:users -- admin@aibetech.es 'ContraseñaSegura1' arquitecta@aibetech.es 'OtraContraseña2'
 * El primero será administrador (ficha "Demo Aibe"); el segundo, arquitecto (ficha "Laura Martín").
 */
import './_env';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function ensureUser(email: string, password: string, role: 'admin' | 'arquitecto', staffEmail: string) {
  const sb = supabaseAdmin();
  const { data: staff } = await sb.from('staff').select('id').eq('email', staffEmail).maybeSingle();
  const list = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`${email}: ${error.message}`);
    user = data.user;
    console.log(`✓ Usuario creado: ${email} (${role})`);
  } else {
    await sb.auth.admin.updateUserById(user.id, { password });
    console.log(`✓ Usuario existente actualizado: ${email} (${role})`);
  }
  await sb.from('profiles').upsert({ user_id: user.id, role, staff_id: staff?.id ?? null });
}

async function main() {
  const [adminEmail, adminPass, archEmail, archPass] = process.argv.slice(2);
  if (!adminEmail || !adminPass) {
    console.error("Uso: npm run setup:users -- <email_admin> <contraseña> [<email_arquitecto> <contraseña>]");
    process.exit(1);
  }
  await ensureUser(adminEmail, adminPass, 'admin', 'demo@aibetech.es');
  if (archEmail && archPass) await ensureUser(archEmail, archPass, 'arquitecto', 'laura.martin@winkgroup.es');
}
main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
