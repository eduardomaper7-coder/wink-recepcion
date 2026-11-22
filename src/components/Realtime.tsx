'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';

/**
 * Refresca la página (Server Components) cuando cambian las tablas indicadas.
 * Agrupa ráfagas de cambios para no recargar en cada fila.
 */
export function RealtimeRefresh({ tables, filter, channel }: { tables: string[]; filter?: string; channel: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(',');
  useEffect(() => {
    const sb = supabaseBrowser();
    let ch = sb.channel(channel);
    for (const t of key.split(',')) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t, ...(filter ? { filter } : {}) }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 400);
      });
    }
    ch.subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      sb.removeChannel(ch);
    };
  }, [router, key, filter, channel]);
  return null;
}
