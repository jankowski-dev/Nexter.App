import type { ReactNode } from 'react';

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-300">
      {children}
    </div>
  );
}

export function FormSuccess({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
