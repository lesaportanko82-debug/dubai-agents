'use client';
import { useFormStatus } from 'react-dom';

/** Submit button that shows what the agent is doing while a slow server action runs. */
export function PendingButton({ children, pending, className, disabled }: { children: React.ReactNode; pending: string; className?: string; disabled?: boolean }) {
  const s = useFormStatus();
  return (
    <button className={className} disabled={disabled || s.pending} aria-busy={s.pending}>
      {s.pending ? <span className="inline-flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" />{pending}</span> : children}
    </button>
  );
}
