import type { ReactNode } from 'react';

export function PageTitle({ title, lead, right }: { title: string; lead?: string; right?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight">{title}</h1>
        {lead && <p className="text-mute mt-1 max-w-[62ch]">{lead}</p>}
      </div>
      {right}
    </header>
  );
}

export function Panel({ children, className = '', title, aside }: { children: ReactNode; className?: string; title?: string; aside?: ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      {(title || aside) && (
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export const STATUS_COLOR: Record<string, string> = {
  evidenced: 'var(--color-ok)',
  claimed: 'var(--color-info)',
  offered: 'var(--color-info)',
  recovered: 'var(--color-verdigris)',
  needs_review: 'var(--color-warn)',
  not_recoverable: 'var(--color-stone-300)',
  written_off: 'var(--color-stone-300)',
  new: 'var(--color-stone-300)',
  // domovoy
  assigned: 'var(--color-info)',
  accepted: 'var(--color-ok)',
  done: 'var(--color-honey)',
  declined: 'var(--color-bad)',
  overdue: 'var(--color-bad)',
};

export function Edge({ status, children, className = '' }: { status: string; children: ReactNode; className?: string }) {
  return (
    <div className={`edge ${className}`} style={{ ['--edge' as string]: STATUS_COLOR[status] ?? 'transparent' }}>
      {children}
    </div>
  );
}

export function Money({ v, cur = 'USD', className = '' }: { v: number; cur?: string; className?: string }) {
  const s = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
  return (
    <span className={`num ${className}`}>
      {s}
      <span className="text-mute text-[0.8em] ml-1">{cur}</span>
    </span>
  );
}

export function Pill({ children, tone = 'stone' }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info' | 'stone' | 'accent' }) {
  const map = {
    ok: 'bg-ok-wash text-ok',
    warn: 'bg-warn-wash text-warn',
    bad: 'bg-bad-wash text-bad',
    info: 'bg-info-wash text-info',
    stone: 'bg-stone-100 text-ink-soft',
    accent: 'accent-wash accent-text',
  } as const;
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[12px] font-medium ${map[tone]}`}>{children}</span>;
}

/** horizontal bar with up to three stacked segments */
export function Bar({ parts, max }: { parts: { v: number; color: string; label: string }[]; max: number }) {
  return (
    <div className="h-3 w-full rounded-sm bg-stone-100 overflow-hidden flex">
      {parts.map(p => (
        <div key={p.label} title={`${p.label}: ${Math.round(p.v)}`} style={{ width: `${max ? (100 * p.v) / max : 0}%`, background: p.color }} />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-mute">{children}</div>;
}
