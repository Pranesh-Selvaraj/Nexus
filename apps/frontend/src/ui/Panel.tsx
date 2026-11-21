import type { ReactNode } from 'react';

/** Surface used for cards and dialogs: one border, one radius, one padding. */
export function Panel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-2xl shadow-black/40 backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}
