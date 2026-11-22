'use client';
import { useTransition, useState } from 'react';
import { dismissEmail, reprocessEmail } from '../expedientes/[id]/actions';

export function InboxActions({ emailId }: { emailId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      <button type="button" disabled={pending} className="underline" onClick={() => start(async () => { const r = await reprocessEmail(emailId); setMsg(r.ok ? 'En cola' : r.error); })}>
        Reprocesar
      </button>
      <button type="button" disabled={pending} className="text-stone underline" onClick={() => start(async () => { const r = await dismissEmail(emailId); setMsg(r.ok ? null : r.error); })}>
        Marcar como revisado
      </button>
      {msg ? <span className="text-stone">{msg}</span> : null}
    </div>
  );
}
