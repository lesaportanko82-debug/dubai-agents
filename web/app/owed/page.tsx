import Link from 'next/link';
import { getLang } from '@/lib/lang';
import { owedView } from '@/lib/owed-view';
import { PageTitle, Panel, Bar } from '@/components/ui';
import { BAND, Stat, money } from '@/components/owed/Bits';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const v = await owedView();
  const sum = (f: (r: (typeof v.rows)[number]) => number) => v.rows.reduce((a, r) => a + f(r), 0);
  const f = v.funnel;
  const steps = [
    { n: f.total, ru: 'Всего сообщений', en: 'All messages', note: ru ? 'маркетплейсы, рекламации, СЦ' : 'marketplace, reclamations, SC' },
    { n: f.unique, ru: 'Без дублей', en: 'Without duplicates', note: ru ? 'один дефект = один случай' : 'one defect = one case' },
    { n: f.confirmed, ru: 'Подтверждено', en: 'Confirmed', note: ru ? 'производственный брак' : 'manufacturing defect' },
    { n: f.ab, ru: 'Уровень A/B', en: 'Level A/B', note: ru ? 'можно в претензию' : 'claimable' },
  ];
  const max = Math.max(...v.rows.map(r => r.claimable + r.inFlight + r.recovered + r.reviewSum), 1);

  return (
    <>
      <PageTitle
        title={ru ? 'Обзор потерь' : 'Loss overview'}
        lead={ru
          ? 'Система контроля качества поставщиков: находит ответственный завод, считает ущерб по договору и доводит претензию до выплаты. Данные демонстрационные: сантехника, вымышленные заводы.'
          : 'Supplier quality & performance: finds the responsible factory, computes the damage by the contract and drives the claim to payment. Demo data: plumbing, fictional factories.'}
      />

      <Panel className="mb-6">
        <div className="px-5 py-5 grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Stat label={ru ? 'Прямой ущерб от брака' : 'Direct defect damage'} sub={ru ? 'подтверждённые случаи × себестоимость' : 'confirmed cases × unit cost'}>{money(sum(r => r.direct))}</Stat>
          <Stat label={ru ? 'Можно предъявить сейчас' : 'Claimable now'} sub={ru ? 'по формулам договоров + штрафы за сроки' : 'by contract formulas + delivery penalties'}><span className="accent-text">{money(sum(r => r.claimable))}</span></Stat>
          <Stat label={ru ? 'Ждёт проверки человеком' : 'Awaiting human review'} sub={`${sum(r => r.review)} ${ru ? 'случаев' : 'cases'}`}><span className="text-warn">{money(sum(r => r.reviewSum))}</span></Stat>
          <Stat label={ru ? 'Предъявлено, ждём' : 'Claimed, pending'} sub={v.overdueClaims.length ? (ru ? `${v.overdueClaims.length} без ответа дольше срока` : `${v.overdueClaims.length} past the reply term`) : ' '}>{money(sum(r => r.inFlight))}</Stat>
          <Stat label={ru ? 'Уже возвращено' : 'Recovered'}><span className="text-ok">{money(sum(r => r.recovered))}</span></Stat>
        </div>
      </Panel>

      <div className="grid gap-5 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
        <Panel title={ru ? 'Воронка: от сообщений до претензии' : 'Funnel: from messages to a claim'}>
          <div className="px-5 pb-5">
            <div className="flex items-end gap-3 h-[170px]" role="img" aria-label={steps.map(s => `${s[lang]} ${s.n}`).join(', ')}>
              {steps.map((s, i) => (
                <div key={s.en} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full gap-1.5">
                  <span className="num font-semibold text-[15px]">{s.n}</span>
                  <div className="w-full rounded-t-md" style={{ height: `${(100 * s.n) / Math.max(steps[0].n, 1)}%`, background: ['#1F5A87', '#8A949B', '#2BB3E6', '#5FA318'][i] }} />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-2">
              {steps.map(s => (
                <div key={s.en} className="flex-1 min-w-0 text-center">
                  <div className="text-[13px] font-medium leading-tight">{s[lang]}</div>
                  <div className="text-[11px] text-mute leading-tight">{s.note}</div>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-mute mt-4 mb-0">{ru ? 'Без дедупликации, атрибуции партии и правильной базы (проданные единицы, а не число жалоб) даже красивый дашборд показал бы неверные цифры.' : 'Without deduplication, batch attribution and the right base (units sold, not complaints) even a nice dashboard would show wrong numbers.'}</p>
          </div>
        </Panel>

        <Panel title={ru ? `Риск-флаги · ${v.flags.length}` : `Risk flags · ${v.flags.length}`}>
          <ul className="px-5 pb-5 space-y-2.5">
            {v.flags.length === 0 && <li className="text-mute">{ru ? 'Флагов нет.' : 'No flags.'}</li>}
            {v.flags.map((fl, i) => (
              <li key={i} className="flex gap-3 items-start text-[14px]">
                <span aria-hidden="true" className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: fl.kind === 'over_allowance' || fl.kind === 'claim_sla' ? '#C2412D' : '#E08A2E' }} />
                <span className="min-w-0 flex-1">{fl.text[lang]}</span>
                <Link className="text-[12px] underline underline-offset-2 text-mute whitespace-nowrap" href={fl.kind === 'claim_sla' ? '/owed/claims' : fl.kind.startsWith('late') || fl.kind === 'delay_growing' ? '/owed/deliveries' : '/owed/batches'}>{ru ? 'открыть' : 'open'}</Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title={ru ? 'Книга долга и рейтинг заводов' : 'Debt ledger and factory score'}>
        <ul className="divide-y divide-stone-200">
          {v.rows.map(r => (
            <li key={r.s.id} className="px-5 py-4 grid gap-4 items-center md:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto]">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <Link href={`/owed/factories/${r.s.code}`} className="font-semibold hover:underline">{r.s.code}</Link>
                  <span className="text-[14px] truncate">{r.s.name}</span>
                </div>
                <div className="text-[12px] text-mute mt-0.5">{r.cases} {ru ? 'случаев' : 'cases'} · {r.lines.length} {ru ? 'партий' : 'batches'} · {ru ? 'опоздание' : 'delay'} {r.ds.avgDelay} {ru ? 'дн.' : 'd'}{!r.contractReady && <span className="text-warn"> · {ru ? 'договор не разобран' : 'contract not analysed'}</span>}</div>
              </div>
              <div className="min-w-0">
                <Bar max={max} parts={[
                  { v: r.recovered, color: 'var(--color-verdigris)', label: ru ? 'возвращено' : 'recovered' },
                  { v: r.inFlight, color: 'var(--color-info)', label: ru ? 'предъявлено' : 'claimed' },
                  { v: r.claimable, color: 'var(--accent)', label: ru ? 'к предъявлению' : 'claimable' },
                  { v: r.reviewSum, color: 'var(--color-warn)', label: ru ? 'на проверке' : 'in review' },
                ]} />
                <div className="mt-1.5 text-[12px] text-mute flex flex-wrap gap-x-3">
                  <span>{ru ? 'возвращено' : 'recovered'} {money(r.recovered)}</span>
                  <span>{ru ? 'предъявлено' : 'claimed'} {money(r.inFlight)}</span>
                  <span>{ru ? 'к предъявлению' : 'claimable'} {money(r.claimable)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 justify-end">
                <div className="text-right">
                  <div className="num text-[22px] font-semibold leading-none" style={{ color: BAND[r.score.band].color }}>{r.score.total}</div>
                  <div className="text-[11px] text-mute">{ru ? 'рейтинг' : 'score'}</div>
                </div>
                {r.claimable > 0 && <Link href={`/owed/claims?supplier=${r.s.code}`} className="rounded-md accent-bg text-white px-3 py-1.5 text-[13px] font-medium whitespace-nowrap">{ru ? 'Претензия' : 'Claim'}</Link>}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
