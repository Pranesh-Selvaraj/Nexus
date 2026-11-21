import type { InputHTMLAttributes, ReactNode, Ref } from 'react';

export function Field({
  id,
  label,
  hint,
  error,
  inputRef,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label
          htmlFor={id}
          className="mb-1 block text-xs font-medium text-zinc-400"
        >
          {label}
        </label>
        {hint && <span className="mb-1 text-[11px] text-zinc-600">{hint}</span>}
      </div>
      <input
        {...props}
        id={id}
        ref={inputRef}
        aria-invalid={error ? true : undefined}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:border-nexus-500 disabled:opacity-60"
      />
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
