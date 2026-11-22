'use server';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export async function signIn(form: FormData) {
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') });
  if (error) redirect(`/login?error=${encodeURIComponent('Email o contraseña incorrectos')}`);
  redirect('/expedientes');
}

export async function signOut() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect('/login');
}
