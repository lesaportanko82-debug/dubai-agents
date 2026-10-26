import Link from 'next/link';
import { getLang, toggleLang } from '@/lib/lang';
import { t, type Key } from '@/lib/i18n';
import { NavLink } from './NavLink';
import { DomovoyNav } from './domovoy/DomovoyNav';
import { panelContext } from '@/lib/domovoy-server';

const DM_ICON: Record<string, 'circle' | 'list' | 'people' | 'shield' | 'wallet' | 'home' | 'scale' | 'chart' | 'spark' | 'chat'> = {
  '/domovoy': 'circle', '/domovoy/tasks': 'list', '/domovoy/family': 'people', '/domovoy/approvals': 'shield',
  '/domovoy/wallet': 'wallet', '/domovoy/profile': 'home', '/domovoy/fairness': 'scale', '/domovoy/impact': 'chart',
  '/domovoy/trace': 'spark', '/domovoy/try': 'chat',
};
const DM_ORDER = ['/domovoy', '/domovoy/tasks', '/domovoy/family', '/domovoy/approvals', '/domovoy/wallet', '/domovoy/profile', '/domovoy/fairness', '/domovoy/impact', '/domovoy/trace', '/domovoy/try'];

async function DomovoyShell({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  const ru = lang === 'ru';
  const ctx = await panelContext();
  const pending = ctx.authenticated ? (await ctx.store.approvals({ status: 'pending' }).catch(() => [])).length : 0;
  const items = DM_ORDER.map(href => {
    const n = NAV.domovoy.find(x => x.href === href)!;
    return { href, label: t(lang, n.key), icon: DM_ICON[href], badge: href === '/domovoy/approvals' ? pending : undefined };
  });
  return (
    <div data-product="domovoy" className="min-h-screen p-3 md:p-6 flex flex-wrap gap-4 md:gap-6 items-start">
      <aside className="flex-[1_1_240px] md:max-w-[256px] w-full md:sticky md:top-6 rounded-[24px] p-4 md:p-5 flex flex-col gap-5" style={{ background: 'var(--dm-forest)', color: '#EAF2EE' }}>
        <div className="flex items-center gap-3 px-1">
          <div className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0" style={{ background: 'var(--dm-hearth)' }}>
            <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1F3B33" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></svg>
          </div>
          <div className="min-w-0 flex flex-col">
            <span className="font-display text-[17px] font-bold">{ru ? 'Домовой' : 'Domovoy'}</span>
            <span className="text-[12px] truncate" style={{ color: 'var(--dm-forest-mute)' }}>{ctx.household?.name ?? (ru ? 'семейный агент' : 'family agent')}</span>
          </div>
          <form action={toggleLang} className="ml-auto">
            <button type="submit" className="min-h-[32px] px-2 rounded-lg text-[12px] font-semibold" style={{ background: 'var(--dm-forest-2)', color: '#FFFFFF' }}>{t(lang, 'lang_toggle')}</button>
          </form>
        </div>
        <DomovoyNav items={items} />
        <div className="hidden md:flex flex-col gap-2 rounded-2xl p-4" style={{ background: 'var(--dm-forest-2)' }}>
          <span className="text-[13px]" style={{ color: 'var(--dm-forest-mute)' }}>{ru ? 'Агент на связи' : 'Agent online'}</span>
          <span className="text-[14px] leading-snug">{ru ? 'Пишите или надиктуйте в Telegram — я распределю дела.' : 'Write or send a voice note in Telegram — I will dispatch it.'}</span>
          <a href="https://t.me/Domovenoklook_bot" target="_blank" rel="noreferrer" className="min-h-[44px] rounded-xl flex items-center justify-center text-[14px] font-bold" style={{ background: 'var(--dm-hearth)', color: 'var(--dm-forest)' }}>{ru ? 'Открыть в Telegram' : 'Open in Telegram'}</a>
          <div className="flex items-center justify-between pt-1 text-[12px]" style={{ color: 'var(--dm-forest-mute)' }}>
            <Link href="/owed" className="underline underline-offset-2">OWED →</Link>
            {ctx.authenticated && <a href="/api/domovoy/logout" className="underline underline-offset-2">{ru ? 'выйти' : 'log out'}</a>}
          </div>
        </div>
      </aside>
      <main className="flex-[999_1_640px] min-w-0 max-w-[1240px]">{children}</main>
    </div>
  );
}

type Product = 'domovoy' | 'owed';

const NAV: Record<Product, { href: string; key: Key }[]> = {
  domovoy: [
    { href: '/domovoy', key: 'd_home' },
    { href: '/domovoy/tasks', key: 'd_tasks' },
    { href: '/domovoy/family', key: 'd_family' },
    { href: '/domovoy/trace', key: 'd_trace' },
    { href: '/domovoy/fairness', key: 'd_fairness' },
    { href: '/domovoy/impact', key: 'd_impact' },
    { href: '/domovoy/approvals', key: 'd_approvals' },
    { href: '/domovoy/wallet', key: 'd_wallet' },
    { href: '/domovoy/profile', key: 'd_profile' },
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
  if (product === 'domovoy') return <DomovoyShell>{children}</DomovoyShell>;
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
