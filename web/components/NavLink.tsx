'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, label, exact }: { href: string; label: string; exact?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path.startsWith(href);
  return (
    <Link
      href={href}
      className={`block whitespace-nowrap rounded-md px-3 py-1.5 text-[14px] ${active ? 'bg-paper font-medium text-ink shadow-[inset_0_0_0_1px_var(--color-stone-200)]' : 'text-ink-soft hover:bg-paper/70'}`}
    >
      {label}
    </Link>
  );
}
