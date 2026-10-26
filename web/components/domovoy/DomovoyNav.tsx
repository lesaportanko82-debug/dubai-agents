'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

const ICONS = {
  circle: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /></>,
  list: <path d="M4 6h16M4 12h16M4 18h10" />,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5" /><circle cx="17" cy="9" r="2.5" /><path d="M16 15c3 0 5 2 5 5" /></>,
  shield: <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18" /></>,
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  scale: <path d="M12 4v16M5 8h14M5 8l-2 6h4zM19 8l-2 6h4z" />,
  chart: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  spark: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="4" /></>,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
} as const;

export function DomovoyNav({ items }: { items: Item[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Разделы" className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
      {items.map(it => {
        const active = it.href === '/domovoy' ? path === it.href : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? 'page' : undefined}
            className="flex items-center gap-3 min-h-[44px] px-3 rounded-xl whitespace-nowrap text-[15px] transition-colors"
            style={active ? { background: 'var(--dm-forest-2)', color: '#FFFFFF', fontWeight: 600 } : { color: 'var(--dm-forest-text)' }}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[it.icon]}</svg>
            <span>{it.label}</span>
            {!!it.badge && (
              <span className="ml-auto min-w-[22px] h-[22px] px-1.5 rounded-full text-[12px] font-bold flex items-center justify-center" style={{ background: 'var(--dm-hearth)', color: 'var(--dm-forest)' }}>{it.badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
