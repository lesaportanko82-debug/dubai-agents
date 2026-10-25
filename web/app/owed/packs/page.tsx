import { owedState } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Empty, Money, Pill } from '@/components/ui';
import { approvePack } from '../actions';
import { buildPackAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function PacksPage({ searchParams }: { searchParams: Promise<{ supplier?: string; error?: string }> }) {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { supplier, error } = await searchParams;
  const { store } = owedState();
  const suppliers = await store.suppliers();
  const packs = [...store.packs()].reverse();
  const supById = new Map(suppliers.map(s => [s.id, s]));

  return (
    <>
      <PageTitle
        title={ru ? 'Переговорные пакеты' : 'Negotiation packs'}
        lead={ru ? 'Агент собирает доказательства, сумму, три варианта компенсации и пункты в контракт, затем пишет письмо на английском и китайском. Отправка заводу — только после вашего одобрения.' : 'The agent assembles evidence, the amount, three compensation options and contract clauses, then drafts the letter in English and Chinese. Nothing is sent until you approve.'}
      />

      <Panel className="mb-5">
        <form action={buildPackAction} className="px-5 py-4 flex flex-wrap items-end gap-3">
          <label className="text-[13px] text-mute">
            {ru ? 'Завод' : 'Factory'}
            <select name="supplier" defaultValue={supplier ?? suppliers[0]?.code} className="block mt-1 rounded-md border border-stone-300 bg-paper px-2 py-1.5 text-[14px] text-ink">
              {suppliers.map(s => <option key={s.id} value={s.code}>{s.code} — {s.name.replace(' (demo)', '')}</option>)}
            </select>
          </label>
          <label className="text-[13px] text-mute">
            {ru ? 'С' : 'From'}
            <input name="from" type="date" defaultValue="2026-07-01" className="block mt-1 rounded-md border border-stone-300 bg-paper px-2 py-1.5 text-[14px] text-ink" />
          </label>
          <label className="text-[13px] text-mute">
            {ru ? 'По' : 'To'}
            <input name="to" type="date" defaultValue="2026-10-31" className="block mt-1 rounded-md border border-stone-300 bg-paper px-2 py-1.5 text-[14px] text-ink" />
          </label>
          <button className="rounded-md accent-bg text-white px-4 py-2 text-[14px] font-medium hover:opacity-90">{ru ? 'Собрать пакет' : 'Build pack'}</button>
          {error && <span className="text-bad text-[13px]">{decodeURIComponent(error)}</span>}
        </form>
      </Panel>

      {packs.length === 0 ? (
        <Panel><Empty>{ru ? 'Пакетов пока нет. Соберите первый для завода с наибольшим долгом.' : 'No packs yet. Build the first one for the factory with the largest debt.'}</Empty></Panel>
      ) : (
        packs.map(p => {
          const s = supById.get(p.supplierId)!;
          return (
            <Panel key={p.id} className="mb-5">
              <div className="px-5 pt-4 pb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-stone-100">
                <h2 className="text-[17px] font-semibold"><span className="accent-text">{s.code}</span> {s.name.replace(' (demo)', '')}</h2>
                <span className="text-mute text-[13px]">{p.periodFrom} — {p.periodTo} · {p.caseIds.length} {ru ? 'случаев' : 'cases'}</span>
                <Money v={p.amount} className="text-[20px] font-semibold" />
                <span className="ml-auto flex items-center gap-3">
                  <Pill tone={p.status === 'approved' ? 'ok' : p.status === 'sent' ? 'info' : 'warn'}>{p.status}</Pill>
                  {p.status === 'draft' && (
                    <form action={approvePack}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="rounded-md accent-bg text-white px-3 py-1.5 text-[13px] font-medium">{ru ? 'Одобрить и предъявить' : 'Approve & claim'}</button>
                    </form>
                  )}
                </span>
              </div>
              <div className="grid lg:grid-cols-[1fr_1fr] gap-0 divide-y lg:divide-y-0 lg:divide-x divide-stone-100">
                <div className="px-5 py-4 space-y-4 text-[14px]">
                  <div>
                    <div className="text-[12px] text-mute mb-1">{ru ? 'Доля брака по партиям' : 'Defect rate by batch'}</div>
                    <ul className="space-y-0.5">
                      {p.defectPctByBatch.map(b => (
                        <li key={b.batchCode} className="flex justify-between num"><span>{b.batchCode} · {b.sku}</span><span>{b.cases}/{b.qty} = <b>{b.pct}%</b> <span className="text-mute">({ru ? 'допуск' : 'allowed'} {b.allowedPct}%)</span></span></li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-[12px] text-mute mb-1">{ru ? 'Варианты компенсации' : 'Compensation options'}</div>
                    <ol className="space-y-1">{p.options.map((o, i) => <li key={o.form} className="flex gap-2"><Pill tone="accent">{i + 1}</Pill><span>{o.description}</span></li>)}</ol>
                  </div>
                  <div>
                    <div className="text-[12px] text-mute mb-1">{ru ? 'Пункты в следующий контракт' : 'Clauses for the next contract'}</div>
                    <ul className="list-disc pl-5 space-y-1 text-ink-soft">{p.contractClauses.map(cl => <li key={cl}>{cl}</li>)}</ul>
                  </div>
                </div>
                <div className="px-5 py-4 grid md:grid-cols-2 gap-4 text-[13px] leading-relaxed">
                  <div><div className="text-[12px] text-mute mb-1">English</div><pre className="whitespace-pre-wrap font-sans">{p.textEn || '—'}</pre></div>
                  <div><div className="text-[12px] text-mute mb-1">中文</div><pre className="whitespace-pre-wrap font-sans">{p.textZh || '—'}</pre></div>
                </div>
              </div>
            </Panel>
          );
        })
      )}
    </>
  );
}
