import Link from 'next/link';
import { owedState } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { Bar, Money, PageTitle, Panel, Pill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function LedgerPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store } = owedState();
  const [suppliers, cases, batches] = await Promise.all([store.suppliers(), store.cases(), store.batches()]);

  const rows = suppliers.map(s => {
    const cs = cases.filter(c => c.supplierId === s.id);
    const sum = (f: (c: (typeof cs)[number]) => boolean) => cs.filter(f).reduce((a, c) => a + c.cost.total, 0);
    return {
      s,
      open: sum(c => ['evidenced', 'claimed', 'offered'].includes(c.status)),
      review: sum(c => c.status === 'needs_review'),
      recovered: sum(c => c.status === 'recovered'),
      cases: cs.length,
      recoverable: cs.filter(c => c.recoverable).length,
      batches: batches.filter(b => b.supplierId === s.id).length,
    };
  });
  const max = Math.max(...rows.map(r => r.open + r.review + r.recovered), 1);
  const totalOpen = rows.reduce((a, r) => a + r.open, 0);
  const totalReview = rows.reduce((a, r) => a + r.review, 0);
  const totalRecovered = rows.reduce((a, r) => a + r.recovered, 0);
  const writtenOffShare = cases.length ? Math.round((100 * cases.filter(c => !c.recoverable).length) / cases.length) : 0;

  return (
    <>
      <PageTitle
        title={ru ? 'Книга долга заводов' : 'Factory debt ledger'}
        lead={ru ? 'Сколько заводы должны за производственный брак — по доказанным случаям за последние 100 дней.' : 'What each factory owes for manufacturing defects — evidenced cases, last 100 days.'}
      />

      {/* the ledger itself is the hero */}
      <Panel className="mb-6">
        <div className="px-5 pt-5 pb-1 flex flex-wrap gap-x-10 gap-y-2 items-baseline">
          <div>
            <div className="text-[13px] text-mute">{ru ? 'К предъявлению' : 'Open to claim'}</div>
            <Money v={totalOpen} className="text-[34px] font-semibold accent-text" />
          </div>
          <div>
            <div className="text-[13px] text-mute">{ru ? 'Ждёт проверки человеком' : 'Awaiting human review'}</div>
            <Money v={totalReview} className="text-[22px] font-semibold text-warn" />
          </div>
          <div>
            <div className="text-[13px] text-mute">{ru ? 'Уже возвращено' : 'Recovered so far'}</div>
            <Money v={totalRecovered} className="text-[22px] font-semibold text-ok" />
          </div>
          <div className="ml-auto text-[13px] text-mute max-w-[28ch]">
            {ru ? `${writtenOffShare}% случаев агент отнёс не к заводу (транспорт, монтаж) и не включил в долг.` : `${writtenOffShare}% of cases were not the factory's fault (transport, installation) and are excluded.`}
          </div>
        </div>

        <ul className="divide-y divide-stone-200 mt-3">
          {rows.sort((a, b) => b.open - a.open).map(r => (
            <li key={r.s.id} className="px-5 py-4 grid md:grid-cols-[minmax(220px,1.1fr)_2fr_auto] gap-x-6 gap-y-2 items-center">
              <div>
                <div className="font-semibold">
                  <span className="accent-text mr-2">{r.s.code}</span>
                  {r.s.name.replace(' (demo)', '')}
                </div>
                <div className="text-[13px] text-mute">
                  {r.cases} {ru ? 'случаев' : 'cases'} · {r.recoverable} {ru ? 'к возврату' : 'recoverable'} · {r.batches} {ru ? 'партии' : 'batches'} · {ru ? 'допуск' : 'allowance'} {r.s.allowedDefectPct}%
                </div>
              </div>
              <div>
                <Bar
                  max={max}
                  parts={[
                    { v: r.recovered, color: 'var(--color-ok)', label: ru ? 'возвращено' : 'recovered' },
                    { v: r.open, color: 'var(--accent)', label: ru ? 'к предъявлению' : 'open' },
                    { v: r.review, color: 'var(--color-warn)', label: ru ? 'на проверке' : 'review' },
                  ]}
                />
                <div className="mt-1.5 flex gap-4 text-[12px] text-mute">
                  <span><i className="inline-block w-2 h-2 rounded-sm bg-ok mr-1" />{ru ? 'возвращено' : 'recovered'} <b className="num text-ink">{Math.round(r.recovered)}</b></span>
                  <span><i className="inline-block w-2 h-2 rounded-sm accent-bg mr-1" />{ru ? 'к предъявлению' : 'open'} <b className="num text-ink">{Math.round(r.open)}</b></span>
                  <span><i className="inline-block w-2 h-2 rounded-sm bg-warn mr-1" />{ru ? 'на проверке' : 'review'} <b className="num text-ink">{Math.round(r.review)}</b></span>
                </div>
              </div>
              <div className="flex md:flex-col gap-2 md:items-end">
                <Link href={`/owed/packs?supplier=${r.s.code}`} className="rounded-md accent-bg text-white px-3 py-1.5 text-[13px] font-medium hover:opacity-90">
                  {ru ? 'Собрать пакет' : 'Build pack'}
                </Link>
                <Link href={`/owed/cases?supplier=${r.s.code}`} className="text-[13px] text-ink-soft hover:text-ink underline-offset-2 hover:underline">
                  {ru ? 'Все случаи' : 'All cases'}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid md:grid-cols-2 gap-5">
        <Panel title={ru ? 'Куда идёт случай' : 'Where a case goes'}>
          <ol className="px-5 pb-5 text-[14px] space-y-2">
            {[
              [ru ? 'Рекламация приходит из Telegram, почты, акта СЦ или отзыва' : 'A complaint arrives from Telegram, email, a service act or a review', 'stone'],
              [ru ? 'Агент убирает личные данные, находит партию и завод, определяет класс дефекта' : 'The agent masks personal data, finds the batch and factory, classifies the defect', 'accent'],
              [ru ? 'Код считает стоимость и решает: в долг завода, на проверку или не к возврату' : 'Code computes the cost and decides: factory debt, human review, or not recoverable', 'info'],
              [ru ? 'Перед заказом агент собирает переговорный пакет, человек одобряет' : 'Before the next order the agent drafts a negotiation pack; a human approves', 'ok'],
            ].map(([txt, tone], i) => (
              <li key={i} className="flex gap-3">
                <Pill tone={tone as 'ok'}>{i + 1}</Pill>
                <span>{txt}</span>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title={ru ? 'Последние случаи' : 'Latest cases'}>
          <ul className="px-5 pb-4 divide-y divide-stone-100">
            {[...cases].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 6).map(c => (
              <li key={c.id} className="py-2 flex items-center gap-3 text-[14px]">
                <span className="num text-mute w-[104px] shrink-0 whitespace-nowrap">{c.receivedAt.slice(5, 10)} {c.receivedAt.slice(11, 16)}</span>
                <span className="font-medium w-[64px] shrink-0">{c.sku}</span>
                <span className="truncate text-ink-soft">{c.description}</span>
                <Money v={c.cost.total} className="ml-auto shrink-0" />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
