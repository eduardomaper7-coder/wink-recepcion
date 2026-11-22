import Image from 'next/image';
import { signIn } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Image src="/brand/wink-logo.png" alt="Wink" width={132} height={42} className="mb-10" priority />
        <h1 className="mb-1 text-xl font-semibold">Recepción del encargo</h1>
        <p className="mb-8 text-sm text-stone">Acceso para arquitectos y administración.</p>
        <form action={signIn} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-stone">Email</span>
            <input name="email" type="email" required autoComplete="email" className="w-full border border-line bg-paper px-3 py-2 outline-none focus:border-ink" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-stone">Contraseña</span>
            <input name="password" type="password" required autoComplete="current-password" className="w-full border border-line bg-paper px-3 py-2 outline-none focus:border-ink" />
          </label>
          {error ? <p className="text-sm text-warn">{error}</p> : null}
          <button className="w-full bg-ink px-4 py-2.5 text-sm font-medium text-cream hover:bg-black">Entrar</button>
        </form>
        <p className="mt-10 text-xs text-stone">Agente desarrollado por Aibe Technologies para Wink Group.</p>
      </div>
    </main>
  );
}
