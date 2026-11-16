import Link from 'next/link';
import { getLang } from '@/lib/lang';
import { owedView } from '@/lib/owed-view';
import { ROLE_LABEL } from '@/lib/owed-server';
import { PageTitle, Panel } from '@/components/ui';
import { ClaimBadge, CLAIM_STATUS, money, date } from '@/components/owed/Bits';
import { TOPIC } from '@/components/owed/topics';
import { CLAIM_FLOW, slaOverdue } from '@core/owed/sqpm';
import type { Claim, ClaimStatus } from '@core/owed/types';
import { buildClaim, claimAction, rewriteLetters } from '../actions';
import { PendingButton } from '@/components/owed/PendingButton';

export const maxDuration = 60;

export const dynamic = 'force-dynamic';

const STEPS: ClaimStatus[] = ['draft', 'reviewed', 'sent', 'acknowledged', 'paid'];
const ACTION_LABEL: Partial<Record<ClaimStatus, { ru: string; en: string }>> = {
  reviewed: { ru: 'Проверено — всё верно', en: 'Checked — all correct' },
  sent: { ru: 'Отправить заводу', en: 'Send to the factory' },
  acknowledged: { ru: 'Завод признал', en: 'Factory acknowledged' },
  disputed: { ru: 'Завод оспорил', en: 'Factory disputed' },
  paid: { ru: 'Деньги получены', en: 'Payment received' },
  legal: { ru: 'Передать юристу', en: 'Escalate to legal' },
  draft: { ru: 'Вернуть в черновик', en: 'Back to draft' },
  withdrawn: { ru: 'Отозвать', en: 'Withdraw' },
};

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ supplier?: string; open?: string; error?: string }> }) {
  const lang = await getLang();
  const ru = lang === 'ru';
  const sp = await searchParams;
  const v = await owedView();
  const supById = new Map(v.suppliers.map(s => [s.id, s]));
  const claims = [...v.claims].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const open: Claim | undefined = claims.find(c => c.id === sp.open) ?? (sp.supplier ? undefined : claims.find(c => c.status === 'draft' || c.status === 'reviewed'));
  const pre = v.rows.find(r => r.s.code === sp.supplier) ?? [...v.rows].sort((a, b) => b.claimable - a.claimable)[0];
  const from = new Date(Date.parse(v.nowIso) - 150 * 86_400_000).toISOString().slice(0, 10);
  const to = v.nowIso.slice(0, 10);

  return (
    <>
      <PageTitle
        title={ru ? 'Претензии заводам' : 'Factory claims'}
        lead={ru
          ? 'Брак партии выше порога → дело собирается из реестра → AI находит пункты договора → ущерб по формуле договора → черновик на RU/EN/中文 → проверка закупщиком → отправка → контроль срока ответа и выплаты. Человек всегда подтверждает финальную претензию.'
          : 'Batch above the allowance → the case is assembled from the registry → AI finds the contract clauses → damage by the contract formula → draft in RU/EN/中文 → buyer check → sent → reply term and payment tracked. A person always approves the final claim.'}
      />
      {sp.error && <p className="mb-4 text-[13px] text-bad">{sp.error === 'nothing' ? (ru ? 'За период нечего предъявлять: нет партий выше порога с доказанными случаями A/B и нет непредъявленных штрафов за сроки.' : 'Nothing to claim in this period.') : sp.error === 'role' ? (ru ? 'Собирать претензии может закупщик или отдел качества.' : 'Buyers or quality build claims.') : sp.error}</p>}

      <Panel className="mb-6" title={ru ? 'Собрать претензию' : 'Build a claim'}>
        <form action={buildClaim} className="px-5 pb-5 flex flex-wrap gap-3 items-end text-[14px]">
          <label className="flex flex-col gap-1"><span className="text-[13px] text-mute">{ru ? 'Завод' : 'Factory'}</span>
            <select name="supplier" defaultValue={pre?.s.code} className="rounded-md border border-stone-300 bg-paper px-2 py-1.5">
              {v.rows.map(r => <option key={r.s.id} value={r.s.code}>{r.s.code} — {r.s.name.replace(' (demo)', '')} · {money(r.claimable)}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span className="text-[13px] text-mute">{ru ? 'С' : 'From'}</span><input type="date" name="from" defaultValue={from} className="rounded-md border border-stone-300 bg-paper px-2 py-1.5" /></label>
          <label className="flex flex-col gap-1"><span className="text-[13px] text-mute">{ru ? 'По' : 'To'}</span><input type="date" name="to" defaultValue={to} className="rounded-md border border-stone-300 bg-paper px-2 py-1.5" /></label>
          <PendingButton className="rounded-md accent-bg text-white px-4 py-2 font-medium disabled:opacity-50" disabled={v.role !== 'buyer' && v.role !== 'quality'} pending={ru ? 'Собираю дело и пишу письма…' : 'Building the case and letters…'}>{ru ? 'Собрать претензию' : 'Build the claim'}</PendingButton>
          <span className="text-[13px] text-mute max-w-[46ch]">{v.role !== 'buyer' && v.role !== 'quality' ? (ru ? `Вы — ${ROLE_LABEL[v.role].ru}. Собирает закупщик или качество.` : `You are ${ROLE_LABEL[v.role].en}.`) : (ru ? 'Только случаи уровня A/B, партии выше порога, ещё не предъявленные. Письма пишет агент.' : 'Only level A/B cases of batches over the allowance, not yet claimed. The agent writes the letters.')}</span>
        </form>
      </Panel>

      {open && <ClaimCard c={open} lang={lang} v={v} supName={supById.get(open.supplierId)?.name ?? ''} supCode={supById.get(open.supplierId)?.code ?? ''} error={sp.open ? sp.error : undefined} />}

      <Panel title={ru ? 'Все претензии' : 'All claims'}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[14px]">
            <thead className="text-[12px] text-mute text-left"><tr className="border-b border-stone-200">
              <th className="px-5 py-2 font-medium">{ru ? 'Номер' : 'Number'}</th><th className="px-2 py-2 font-medium">{ru ? 'Завод' : 'Factory'}</th><th className="px-2 py-2 font-medium">{ru ? 'Период' : 'Period'}</th>
              <th className="px-2 py-2 font-medium text-right">{ru ? 'Сумма' : 'Amount'}</th><th className="px-2 py-2 font-medium">{ru ? 'Статус' : 'Status'}</th><th className="px-2 py-2 font-medium">{ru ? 'Срок ответа' : 'Reply due'}</th><th className="px-5 py-2 font-medium text-right">{ru ? 'Получено' : 'Received'}</th>
            </tr></thead>
            <tbody>
              {claims.map(c => {
                const late = slaOverdue(c, v.nowIso);
                return (
                  <tr key={c.id} className={`border-b border-stone-100 last:border-0 ${c.id === open?.id ? 'accent-wash' : ''}`}>
                    <td className="px-5 py-2.5"><Link href={`/owed/claims?open=${c.id}`} className="font-semibold hover:underline num">{c.number}</Link></td>
                    <td className="px-2 py-2.5">{supById.get(c.supplierId)?.code}</td>
                    <td className="px-2 py-2.5 num text-mute text-[13px]">{date(c.periodFrom)} — {date(c.periodTo)}</td>
                    <td className="px-2 py-2.5 num text-right">{money(c.amount)}</td>
                    <td className="px-2 py-2.5"><ClaimBadge status={c.status} lang={lang} /></td>
                    <td className={`px-2 py-2.5 num text-[13px] ${late ? 'text-bad font-semibold' : 'text-mute'}`}>{c.dueAt && ['sent', 'disputed'].includes(c.status) ? `${date(c.dueAt)}${late ? (ru ? ' · просрочено' : ' · overdue') : ''}` : '—'}</td>
                    <td className="px-5 py-2.5 num text-right">{c.paidAmount ? money(c.paidAmount) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function ClaimCard({ c, lang, v, supName, supCode, error }: { c: Claim; lang: 'ru' | 'en'; v: Awaited<ReturnType<typeof owedView>>; supName: string; supCode: string; error?: string }) {
  const ru = lang === 'ru';
  const next = CLAIM_FLOW[c.status];
  const late = slaOverdue(c, v.nowIso);
  const stepIdx = STEPS.indexOf(c.status);
  const daysLeft = c.dueAt ? Math.ceil((Date.parse(c.dueAt) - Date.parse(v.nowIso)) / 86_400_000) : null;

  return (
    <Panel className="mb-6">
      <div className="px-5 pt-5 pb-4 flex flex-wrap items-start justify-between gap-4 border-b border-stone-100">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-[18px] num">{c.number}</span><ClaimBadge status={c.status} lang={lang} />{c.letters.source === 'template' && c.status !== 'paid' && <span className="text-[12px] text-mute">{ru ? 'письмо по шаблону' : 'template letter'}</span>}</div>
          <div className="text-[14px] mt-1"><Link className="hover:underline" href={`/owed/factories/${supCode}`}>{supCode} · {supName}</Link></div>
          <div className="text-[13px] text-mute">{ru ? 'Период' : 'Period'} {date(c.periodFrom)} — {date(c.periodTo)}</div>
        </div>
        <div className="text-right">
          <div className="text-[13px] text-mute">{ru ? 'К возмещению' : 'Claimed'}</div>
          <div className="num text-[30px] font-semibold accent-text leading-tight">{money(c.amount, c.currency)}</div>
          {c.directDamage > 0 && <div className="text-[12px] text-mute">{ru ? 'прямой ущерб' : 'direct damage'} {money(c.directDamage)} · {ru ? 'по договору с логистикой и сервисом' : 'by contract incl. logistics & service'}</div>}
        </div>
      </div>

      {/* lifecycle */}
      <ol className="px-5 py-4 flex flex-wrap gap-2 items-center border-b border-stone-100 text-[13px]" aria-label={ru ? 'Этапы претензии' : 'Claim stages'}>
        {STEPS.map((st, i) => {
          const passed = stepIdx >= i || (c.status === 'disputed' || c.status === 'legal') && i <= 2;
          const h = c.history.find(x => x.status === st);
          return (
            <li key={st} className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 border ${passed ? 'accent-bg text-white border-transparent' : 'border-stone-300 text-mute'}`}>{i + 1}. {CLAIM_STATUS[st][lang]}{h ? ` · ${date(h.at)}` : ''}</span>
              {i < STEPS.length - 1 && <span aria-hidden="true" className="text-mute">→</span>}
            </li>
          );
        })}
        {(c.status === 'disputed' || c.status === 'legal') && <li><ClaimBadge status={c.status} lang={lang} /></li>}
      </ol>

      <div className="px-5 py-4 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {c.batches.length > 0 && (
            <section>
              <h3 className="text-[14px] font-semibold mb-2">{ru ? 'Брак сверх договорного порога' : 'Defects above the contract allowance'}</h3>
              <ul className="space-y-2 text-[14px]">
                {c.batches.map(b => (
                  <li key={b.batchCode} className="rounded-md border border-stone-200 px-3 py-2">
                    <div className="flex justify-between gap-2"><Link className="font-semibold hover:underline" href={`/owed/cases?batch=${b.batchCode}`}>{b.batchCode} · {b.sku}</Link><span className="num font-semibold">{money(b.amount ?? 0)}</span></div>
                    <div className="text-[13px] text-mute num">{b.cases} {ru ? 'подтв. дефектов из' : 'confirmed of'} {b.soldUnits?.toLocaleString('en-US')} {ru ? 'проданных' : 'sold'} = <b className="text-bad">{b.pct}%</b> {ru ? 'при допуске' : 'vs'} {b.allowedPct}% ({ru ? 'п.' : 'cl.'} {b.clauseRef}) · {ru ? 'к возмещению' : 'claimed'} {b.compensatedCases} {ru ? 'шт.' : 'units'}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {c.deliveryPenalties.length > 0 && (
            <section>
              <h3 className="text-[14px] font-semibold mb-2">{ru ? 'Штраф за сроки поставок' : 'Delivery penalties'}</h3>
              <ul className="space-y-1 text-[13px]">
                {c.deliveryPenalties.map(p => <li key={p.po} className="flex justify-between gap-2 num"><span>{p.po}: {ru ? 'по договору' : 'due'} {date(p.plannedAt)} → {date(p.actualAt)}, +{p.daysLate} {ru ? 'дн.' : 'd'} ({p.billableDays} {ru ? 'к оплате' : 'billable'}{p.clauseRef ? `, ${ru ? 'п.' : 'cl.'} ${p.clauseRef}` : ''})</span><span>{money(p.amount)}</span></li>)}
              </ul>
            </section>
          )}
          {c.clauseRefs.length > 0 && (
            <section>
              <h3 className="text-[14px] font-semibold mb-2">{ru ? 'Пункты договора' : 'Contract clauses'}</h3>
              <ul className="space-y-1.5 text-[13px]">{c.clauseRefs.map(r => <li key={r.ref + r.topic}><b>{ru ? 'п.' : 'cl.'} {r.ref}</b> · {TOPIC[r.topic][lang]}: <span className="text-mute">«{r.quote}»</span></li>)}</ul>
            </section>
          )}
          {c.caseIds.length > 0 && (
            <section className="text-[13px] text-mute">
              {ru ? 'Доказательства собраны автоматически' : 'Evidence assembled automatically'}: {c.evidence.photos} {ru ? 'фото' : 'photos'}, {c.evidence.reclamations} {ru ? 'рекламаций' : 'reclamations'}, {c.evidence.serviceActs} {ru ? 'актов СЦ' : 'service acts'}, {c.evidence.marketplace} {ru ? 'обращений с маркетплейсов' : 'marketplace messages'} · {c.caseIds.length} {ru ? 'случаев без дублей' : 'deduplicated cases'}.
            </section>
          )}
          {c.options.length > 0 && (
            <section>
              <h3 className="text-[14px] font-semibold mb-2">{ru ? 'Варианты компенсации' : 'Compensation options'}</h3>
              <ol className="list-decimal pl-5 space-y-1 text-[13px]">{c.options.map(o => <li key={o.form}>{o.description}</li>)}</ol>
              <h3 className="text-[14px] font-semibold mt-3 mb-2">{ru ? 'Пункты в следующий договор' : 'Clauses for the next contract'}</h3>
              <ul className="list-disc pl-5 space-y-1 text-[13px]">{c.proposedClauses.map(p => <li key={p}>{p}</li>)}</ul>
            </section>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div className="rounded-md border border-stone-200 p-4">
            <h3 className="text-[14px] font-semibold mb-2">{ru ? 'Следующий шаг' : 'Next step'}</h3>
            {error && <p className="text-[13px] text-bad mb-2">{error}</p>}
            {c.status === 'sent' && c.dueAt && <p className={`text-[13px] mb-2 ${late ? 'text-bad font-semibold' : 'text-mute'}`}>{late ? (ru ? `Нет ответа: срок истёк ${date(c.dueAt)}. По договору претензия без ответа считается принятой.` : `No reply: the term expired ${date(c.dueAt)}.`) : (ru ? `Ждём ответ до ${date(c.dueAt)} · осталось ${daysLeft} дн.` : `Reply due ${date(c.dueAt)} · ${daysLeft} days left`)}</p>}
            {next.length === 0 ? <p className="text-[13px] text-mute m-0">{c.status === 'paid' ? (ru ? `Закрыто: получено ${money(c.paidAmount ?? 0)} ${date(c.paidAt)}.` : `Closed: received ${money(c.paidAmount ?? 0)}.`) : '—'}</p> : (
              <div className="flex flex-col gap-2">
                {next.map(n => {
                  const allowed = n.roles.includes(v.role);
                  return (
                    <form key={n.to} action={claimAction} className="flex flex-wrap gap-2 items-center">
                      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value={n.to} />
                      {n.to === 'paid' && <><label className="sr-only" htmlFor={`paid-${c.id}`}>{ru ? 'Сумма' : 'Amount'}</label><input id={`paid-${c.id}`} name="paid" type="number" step="0.01" defaultValue={c.amount} className="w-32 rounded-md border border-stone-300 bg-paper px-2 py-1.5 text-[14px]" /></>}
                      <button disabled={!allowed} className={`rounded-md px-3 py-1.5 text-[14px] font-medium disabled:opacity-40 ${['reviewed', 'sent', 'acknowledged', 'paid'].includes(n.to) ? 'accent-bg text-white' : 'border border-stone-300 bg-paper'}`}>{ACTION_LABEL[n.to]?.[lang] ?? n.to}</button>
                      {!allowed && <span className="text-[12px] text-mute">{ru ? 'может' : 'by'}: {n.roles.map(r => ROLE_LABEL[r][lang]).join(', ')}</span>}
                    </form>
                  );
                })}
              </div>
            )}
          </div>

          {['draft', 'reviewed'].includes(c.status) && (
            <form action={rewriteLetters} className="flex items-center gap-2 text-[13px]">
              <input type="hidden" name="id" value={c.id} />
              <PendingButton className="underline underline-offset-2 disabled:opacity-40" disabled={v.role !== 'buyer' && v.role !== 'quality'} pending={ru ? 'Агент пишет письма…' : 'The agent is writing…'}>{c.letters.source === 'model' ? (ru ? 'Переписать письмо агентом' : 'Rewrite with the agent') : (ru ? 'Написать письмо агентом (сейчас шаблон)' : 'Write with the agent (template now)')}</PendingButton>
              <span className="text-mute">{ru ? 'до минуты' : 'up to a minute'}</span>
            </form>
          )}
          {(c.letters.en || c.letters.zh || c.letters.ru) && (
            <div className="space-y-2">
              {([['ru', 'Русский (для архива)'], ['en', 'English'], ['zh', '中文']] as const).map(([k, label]) => c.letters[k] ? (
                <details key={k} open={k === (lang === 'ru' ? 'ru' : 'en')} className="rounded-md border border-stone-200">
                  <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold">{label}</summary>
                  <pre className="px-3 pb-3 whitespace-pre-wrap text-[13px] leading-relaxed font-sans">{c.letters[k]}</pre>
                </details>
              ) : null)}
            </div>
          )}

          <ol className="text-[12px] text-mute space-y-0.5">
            {c.history.map((h, i) => <li key={i} className="num">{date(h.at)} · {CLAIM_STATUS[h.status][lang]} · {h.role === 'agent' ? (ru ? 'агент' : 'agent') : ROLE_LABEL[h.role][lang]}{h.note ? ` · ${h.note}` : ''}</li>)}
          </ol>
        </div>
      </div>
    </Panel>
  );
}
