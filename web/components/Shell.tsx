import Link from 'next/link';
import { getLang, toggleLang } from '@/lib/lang';
import { t, type Key } from '@/lib/i18n';
import { NavLink } from './NavLink';

type Product = 'domovoy' | 'owed';

const NAV: Record<Product, { href: string; key: Key }[]> = {
  domovoy: [
    { href: '/domovoy', key: 'd_home' },
    { href: '/domovoy/tasks', key: 'd_tasks' },
    { href: '/domovoy/family', key: 'd_family' },
    { href: '/domovoy/trace', key: 'd_trace' },
    { href: '/domovoy/fairness', key: 'd_fairness' },
    { href: '/domovoy/impact', key: 'd_impact' },
    { href: '/domovoy/try', key: 'd_sim' },
  ],
  owed: [
    { href: '/owed', key: 'o_home' },
    { href: '/owed/cases', key: 'o_cases' },
    { href: '/owed/review', key: 'o_review' },
    { href: '/owed/batches', key: 'o_batches' },
    { href: '/owed/packs', key: 'o_packs' },
    { href: '/owed/intake', key: 'o_intake' },
  ],
};

export async function Shell({ product, children }: { product: Product; children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <div data-product={product} className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="border-b md:border-b-0 md:border-r border-stone-200 bg-stone-100/60 md:min-h-screen">
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <span className="text-[13px] text-mute">{t(lang, 'platform')}</span>
          <form action={toggleLang}>
            <button className="text-[12px] font-medium text-ink-soft hover:text-ink px-2 py-1 rounded border border-stone-300 bg-paper" type="submit">
              {t(lang, 'lang_toggle')}
            </button>
          </form>
        </div>

        {/* product switcher: two homes */}
        <div className="px-3 grid grid-cols-2 md:grid-cols-1 gap-2">
          {(['domovoy', 'owed'] as Product[]).map(p => {
            const active = p === product;
            return (
              <Link
                key={p}
                href={`/${p}`}
                data-product={p}
                className={`block rounded-card border px-3 py-2.5 ${active ? 'border-transparent accent-wash' : 'border-stone-200 bg-paper hover:border-stone-300'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2.5 h-2.5 rounded-full accent-bg" />
                  <span className="font-semibold text-[15px]">{t(lang, p)}</span>
                </div>
                <div className="text-[12px] text-mute mt-0.5 pl-[18px]">{t(lang, `${p}_tag` as Key)}</div>
              </Link>
            );
          })}
        </div>

        <nav className="mt-5 px-3 pb-4 flex md:block gap-1 overflow-x-auto">
          {NAV[product].map(n => (
            <NavLink key={n.href} href={n.href} label={t(lang, n.key)} exact={n.href === `/${product}`} />
          ))}
        </nav>
      </aside>

      <main className="px-5 md:px-10 py-7 max-w-[1240px] w-full">{children}</main>
    </div>
  );
}
