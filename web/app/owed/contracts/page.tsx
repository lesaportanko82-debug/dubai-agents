import Link from 'next/link';
import { getLang } from '@/lib/lang';
import { owedContext } from '@/lib/owed-server';
import { PageTitle, Panel } from '@/components/ui';
import { TOPIC } from '@/components/owed/topics';
import { analyseContract, clauseAction } from '../actions';
import { date } from '@/components/owed/Bits';

export const dynamic = 'force-dynamic';

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ c?: string; error?: string; rejected?: string }> }) {
  const lang = await getLang();
  const ru = lang === 'ru';
  const sp = await searchParams;
  const { store, role } = await owedContext();
  const [contracts, suppliers] = await Promise.all([store.contracts(), store.suppliers()]);
  const list = [...contracts].sort((a, b) => (suppliers.find(s => s.id === a.supplierId)?.code ?? '').localeCompare(suppliers.find(s => s.id === b.supplierId)?.code ?? ''));
  const ct = list.find(c => c.id === sp.c) ?? list.find(c => !c.clauses.some(x => x.confirmed)) ?? list[0];
  const sup = suppliers.find(s => s.id === ct?.supplierId);
  const may = role === 'buyer' || role === 'management';
  const pending = ct?.clauses.filter(c => !c.confirmed) ?? [];
  const confirmed = ct?.clauses.filter(c => c.confirmed) ?? [];

  // highlight the clause numbers the system relies on
  const used = new Set(confirmed.map(c => c.ref));
  const lines = (ct?.text ?? '').split('\n');

  return (
    <>
      <PageTitle
        title={ru ? 'Договоры заводов' : 'Factory contracts'}
        lead={ru
          ? 'AI находит в договоре гарантию, порог брака, формулу компенсации, штрафы за сроки и срок ответа — каждое условие со ссылкой на пункт и дословной цитатой. Код проверяет цитату по тексту; в расчёт условие идёт только после подтверждения человеком.'
          : 'AI finds the warranty, defect allowance, compensation formula, delivery penalties and reply term — each with its clause and a verbatim quote. Code checks the quote against the text; a term counts only after a person confirms it.'}
      />
      <div className="flex flex-wrap gap-2 mb-5">
        {list.map(c => {
          const s = suppliers.find(x => x.id === c.supplierId);
          const ready = c.clauses.some(x => x.confirmed);
          return (
            <Link key={c.id} href={`/owed/contracts?c=${c.id}`} className={`rounded-full px-3 py-1 text-[13px] border ${c.id === ct?.id ? 'accent-bg text-white border-transparent' : 'border-stone-300 bg-paper'}`}>
              {s?.code} · {c.number}{!ready && <span className={c.id === ct?.id ? '' : 'text-warn'}> · {ru ? 'не разобран' : 'not analysed'}</span>}
            </Link>
          );
        })}
      </div>
      {sp.error && <p className="mb-4 text-[13px] text-bad">{sp.error === 'role' ? (ru ? 'Анализ договора запускает закупщик или руководство.' : 'Buyer or management run the analysis.') : sp.error}</p>}
      {sp.rejected && Number(sp.rejected) > 0 && <p className="mb-4 text-[13px] text-warn">{ru ? `Отброшено ${sp.rejected} условий: цитата не нашлась в тексте договора дословно или число в ней не совпало.` : `${sp.rejected} terms dropped: the quote was not in the contract word for word, or the number did not match.`}</p>}

      {ct && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
          <Panel title={`${sup?.name} · ${ct.number} ${ru ? 'от' : 'of'} ${date(ct.signedAt)}`}>
            <div className="px-5 pb-5 text-[13px] leading-relaxed font-mono overflow-x-auto">
              {lines.map((l, i) => {
                const ref = l.match(/^(\d+\.\d+)\s/)?.[1];
                const hit = ref && used.has(ref);
                return <div key={i} className={`py-0.5 ${/^\d+\. [A-Z]/.test(l) || i === 0 ? 'font-semibold mt-2' : ''}`} style={hit ? { background: 'var(--accent-wash)' } : undefined}>{l}</div>;
              })}
            </div>
          </Panel>

          <div className="flex flex-col gap-5">
            <Panel title={ru ? 'Условия, которые использует система' : 'Terms the system uses'}>
              {confirmed.length === 0 ? (
                <div className="px-5 pb-5 text-[14px]">
                  <p className="m-0 mb-3 text-warn">{ru ? 'Нет подтверждённых условий — для этого завода расчёты идут по умолчанию.' : 'No confirmed terms — defaults apply for this factory.'}</p>
                  <form action={analyseContract}><input type="hidden" name="id" value={ct.id} />
                    <button className="rounded-md accent-bg text-white px-4 py-2 text-[14px] font-medium disabled:opacity-50" disabled={!may}>{ru ? 'Запустить AI-анализ договора' : 'Run AI contract analysis'}</button>
                  </form>
                  {!may && <p className="text-[12px] text-mute mt-2">{ru ? 'Нужна роль «Закупщик» или «Руководство».' : 'Requires Buyer or Management.'}</p>}
                </div>
              ) : (
                <ul className="px-5 pb-5 space-y-3">
                  {confirmed.map(c => (
                    <li key={c.ref + c.topic} className="text-[14px]">
                      <div className="flex justify-between gap-2"><span>{TOPIC[c.topic][lang]}{c.sku ? ` · ${c.sku}` : ''}</span><b className="num">{c.basis ? (c.basis === 'all_cases' ? (ru ? 'все случаи' : 'all cases') : (ru ? 'сверх порога' : 'above allowance')) : c.value != null ? `${c.value}${TOPIC[c.topic].unit[lang]}` : '✓'}</b></div>
                      <div className="text-[12px] text-mute mt-0.5">{ru ? 'п.' : 'cl.'} {c.ref} · «{c.quote}» · {c.extractedBy === 'agent' ? (ru ? 'найдено AI, подтверждено' : 'found by AI, confirmed') : ru ? 'подтверждено' : 'confirmed'}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {pending.length > 0 && (
              <Panel title={ru ? `Найдено AI — ждёт подтверждения · ${pending.length}` : `Found by AI — awaiting confirmation · ${pending.length}`}>
                <ul className="px-5 pb-5 space-y-3">
                  {pending.map(c => (
                    <li key={c.ref + c.topic} className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[14px]">
                      <div className="flex justify-between gap-2"><span>{TOPIC[c.topic][lang]}{c.sku ? ` · ${c.sku}` : ''}</span><b className="num">{c.basis ? (c.basis === 'all_cases' ? (ru ? 'все случаи' : 'all cases') : (ru ? 'сверх порога' : 'above allowance')) : c.value != null ? `${c.value}${TOPIC[c.topic].unit[lang]}` : '✓'}</b></div>
                      <div className="text-[12px] text-mute mt-0.5">{ru ? 'п.' : 'cl.'} {c.ref} · «{c.quote}» · {ru ? 'цитата сверена с текстом' : 'quote verified against the text'}</div>
                      <div className="mt-2 flex gap-2">
                        <form action={clauseAction}><input type="hidden" name="id" value={ct.id} /><input type="hidden" name="ref" value={c.ref} /><input type="hidden" name="topic" value={c.topic} /><input type="hidden" name="op" value="confirm" />
                          <button className="rounded-md accent-bg text-white px-3 py-1 text-[13px] font-medium disabled:opacity-50" disabled={!may}>{ru ? 'Подтвердить' : 'Confirm'}</button></form>
                        <form action={clauseAction}><input type="hidden" name="id" value={ct.id} /><input type="hidden" name="ref" value={c.ref} /><input type="hidden" name="topic" value={c.topic} /><input type="hidden" name="op" value="drop" />
                          <button className="rounded-md border border-stone-300 bg-paper px-3 py-1 text-[13px] disabled:opacity-50" disabled={!may}>{ru ? 'Отклонить' : 'Drop'}</button></form>
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {confirmed.length > 0 && (
              <form action={analyseContract}><input type="hidden" name="id" value={ct.id} />
                <button className="text-[13px] underline underline-offset-2 text-mute disabled:opacity-50" disabled={!may}>{ru ? 'Проверить договор агентом ещё раз' : 'Re-run the AI analysis'}</button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
