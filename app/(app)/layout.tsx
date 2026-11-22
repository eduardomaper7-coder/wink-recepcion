import Image from 'next/image';
import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { signOut } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const links = [
    { href: '/expedientes', label: 'Expedientes' },
    { href: '/bandeja', label: 'Bandeja de revisión' },
    { href: '/demo', label: 'Pantalla de demo' },
    ...(user.role === 'admin' ? [{ href: '/ajustes', label: 'Ajustes' }] : []),
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-cream/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-8 px-6">
          <Link href="/expedientes" className="flex items-center gap-3">
            <Image src="/brand/wink-logo.png" alt="Wink" width={70} height={22} priority />
            <span className="hidden text-xs uppercase tracking-[0.18em] text-stone sm:inline">Recepción del encargo</span>
          </Link>
          <nav className="flex gap-5 text-sm">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="text-ink/70 hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-stone">
              {user.staffName ?? user.email} · {user.role === 'admin' ? 'Administración' : 'Arquitecto'}
            </span>
            <form action={signOut}>
              <button className="text-ink/70 underline-offset-4 hover:underline">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
    </div>
  );
}
