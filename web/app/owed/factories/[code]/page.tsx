import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLang } from '@/lib/lang';
import { owedView } from '@/lib/owed-view';
import { PageTitle, Panel } from '@/components/ui';
import { BAND, ClaimBadge, RateBar, money, date } from '@/components/owed/Bits';
import { TOPIC } from '@/components/owed/topics';

export const dynamic = 'force-dynamic';

export default async function FactoryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const lang = await getLang();
  const ru = lang === 'ru';
  const v = await owedView();
  const r = v.rows.find(x => x.s.code === code);
  if (!r) notFound();
  const b = BAND[r.score.band];
  const t = r.terms;
  const claims = v.claims.filter(c => c.supplierId === r.s.id).sort((a, c) => c.createdAt.localeCompare(a.createdAt));
  const flags = v.flags.filter(f => f.supplierId === r.s.id);
  const maxPct = Math.max(4, ...r.lines.map(x => x.line.pct * 1.2));

  return (
    <>
      <PageTitle
        title={`${r.s.code} · ${r.s.name}`}
        lead={`${r.s.city} · ${ru ? 'договор' : 'contract'} ${r.contract?.number ?? '—'} ${ru ? 'от' : 'of'} ${date(r.contract?.signedAt)} · ${ru ? 'язык переписки' : 'correspondence'}: ${r.s.contactLang === 'zh' ? '中文 + English' : 'English'}`}
        right={<div className="flex items-center gap-3"><div className="text-right"><div className="num text-[30px] font-bold leading-none" style={{ color: b.color }}>{r.score.total}</div><div className="text-[12px]" style={{ color: b.color }}>{b[lang]}</div></div>
          {r.claimable > 0 && <Link href={`/owed/claims?supplier=${r.s.code}`} className="rounded-md accent-bg text-white px-3 py-2 text-[14px] font-medium">{ru ? `Претензия · ${money(r.claimable)}` : `Claim · ${money(r.claimable)}`}</Link>}</div>}
      />

      {flags.length > 0 && (
        <ul className="mb-5 rounded-card border border-red-200 bg-red-50/60 px-5 py-3 space-y-1 text-[14px]">
          {flags.map((f, i) => <li key={i} className="flex gap-2"><span aria-hidden="true" className="text-bad">●</span>{f.text[lang]}</li>)}
        </ul>
      )}

      <div className="grid gap-5 mb-5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        <Panel title={ru ? 'Условия договора' : 'Contract terms'} aside={<Link href={`/owed/contracts?c=${r.contract?.id}`} className="text-[13px] underline underline-offset-2">{ru ? 'текст и AI-анализ' : 'text & AI analysis'}</Link>}>
          {!r.contractReady ? (
            <p className="px-5 pb-5 text-[14px] text-warn">{ru ? 'Договор ещё не разобран: сроки и пороги считаются по умолчанию (допуск опоздания 0 дн.). Откройте договор и запустите AI-анализ.' : 'Contract not analysed yet: defaults apply (0 days of delivery grace). Open the contract and run the AI analysis.'}</p>
          ) : (
            <ul className="px-5 pb-5 space-y-2 text-[14px]">
              {(r.contract?.clauses ?? []).filter(c => c.confirmed).map(c => (
                <li key={c.ref + c.topic} className="flex gap-3">
                  <span className="num text-mute w-10 shrink-0">{ru ? 'п.' : 'cl.'} {c.ref}</span>
                  <span className="min-w-0">{TOPIC[c.topic][lang]}{c.sku ? ` (${c.sku})` : ''}: <b>{c.basis ? (c.basis === 'all_cases' ? (ru ? 'все подтверждённые случаи' : 'every confirmed case') : (ru ? 'только сверх порога' : 'only above the allowance')) : c.value != null ? `${c.value}${TOPIC[c.topic].unit[lang]}` : ru ? 'да' : 'yes'}</b></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={ru ? 'Сроки поставок' : 'Delivery'} aside={<Link href="/owed/deliveries" className="text-[13px] underline underline-offset-2">{ru ? 'все заводы' : 'all factories'}</Link>}>
          <div className="px-5 pb-5 text-[14px]">
            <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3">
              <span>{ru ? 'Поставок' : 'Deliveries'}: <b className="num">{r.ds.count}</b></span>
              <span>{ru ? 'В срок' : 'On time'}: <b className="num">{r.ds.onTimePct}%</b></span>
              <span>{ru ? 'Среднее опоздание' : 'Avg delay'}: <b className="num">{r.ds.avgDelay} {ru ? 'дн.' : 'd'}</b></span>
              <span>{ru ? 'Штраф по договору' : 'Contract penalty'}: <b className="num">{money(r.ds.penalty)}</b></span>
            </div>
            <ul className="space-y-1.5">
              {r.ds.rows.slice(-6).map(x => (
                <li key={x.d.id} className="grid grid-cols-[110px_minmax(0,1fr)_auto] gap-2 text-[13px]">
                  <span className="num">{x.d.po}</span>
                  <span className="text-mute num">{ru ? 'по договору' : 'due'} {date(x.d.plannedAt)} → {x.d.actualAt ? date(x.d.actualAt) : ru ? 'в пути' : 'in transit'}</span>
                  <span className={`num ${x.bucket === 'late_more' ? 'text-bad' : x.bucket === 'late_7' ? 'text-warn' : 'text-ok'}`}>{x.daysLate == null ? '—' : x.daysLate === 0 ? (ru ? 'в срок' : 'on time') : `+${x.daysLate} ${ru ? 'дн.' : 'd'}`}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      <Panel className="mb-5" title={ru ? 'Партии и брак' : 'Batches and defects'}>
        <ul className="px-5 pb-5 space-y-3">
          {r.lines.map(x => (
            <li key={x.b.id} className="grid gap-2 md:grid-cols-[150px_minmax(0,1fr)_120px] items-center text-[14px]">
              <Link href={`/owed/cases?batch=${x.b.code}`} className="font-semibold hover:underline">{x.b.code} <span className="font-normal text-mute">{x.b.sku}</span></Link>
              <div><RateBar pct={x.line.pct} allowed={x.line.allowedPct} max={maxPct} /><div className="text-[12px] text-mute mt-1 num">{x.line.cases} {ru ? 'из' : 'of'} {(x.b.soldUnits ?? x.b.qty).toLocaleString('en-US')} {ru ? 'проданных' : 'sold'} = {x.line.pct}% · {ru ? 'допуск' : 'allowed'} {x.line.allowedPct}% ({ru ? 'п.' : 'cl.'} {x.line.clauseRef ?? '—'})</div></div>
              <span className="num text-right">{money(x.line.cases * x.b.unitCost)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={ru ? 'Претензии и компенсации' : 'Claims and compensation'}>
        {claims.length === 0 ? <p className="px-5 pb-5 text-mute">{ru ? 'Претензий не было.' : 'No claims yet.'}</p> : (
          <ul className="divide-y divide-stone-100">
            {claims.map(c => (
              <li key={c.id} className="px-5 py-3 grid gap-2 md:grid-cols-[130px_minmax(0,1fr)_auto] items-center text-[14px]">
                <Link href={`/owed/claims?open=${c.id}`} className="font-semibold hover:underline num">{c.number}</Link>
                <span className="text-mute text-[13px]">{date(c.periodFrom)} — {date(c.periodTo)} · {c.caseIds.length ? `${c.caseIds.length} ${ru ? 'случаев' : 'cases'}` : ''}{c.deliveryAmount ? ` · ${ru ? 'штрафы за сроки' : 'delivery penalties'} ${money(c.deliveryAmount)}` : ''}</span>
                <span className="flex items-center gap-2 justify-end"><span className="num">{money(c.amount)}</span>{c.paidAmount ? <span className="num text-ok text-[13px]">{ru ? 'получено' : 'received'} {money(c.paidAmount)}</span> : null}<ClaimBadge status={c.status} lang={lang} /></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="mt-3 text-[12px] text-mute">{ru ? `Условия: гарантия ${t.warrantyMonths} мес., допуск брака ${t.allowedDefectPct}%, ответ на претензию ${t.claimResponseDays} дн.` : `Terms: warranty ${t.warrantyMonths} months, defect allowance ${t.allowedDefectPct}%, claim reply ${t.claimResponseDays} days.`}</p>
    </>
  );
}
