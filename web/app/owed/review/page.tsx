import { owedState } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Empty, Money } from '@/components/ui';
import { CaseRow } from '@/components/owed/CaseRow';
import { reviewCase } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store } = owedState();
  const [suppliers, batches, all] = await Promise.all([store.suppliers(), store.batches(), store.cases()]);
  const supById = new Map(suppliers.map(s => [s.id, s]));
  const batchById = new Map(batches.map(b => [b.id, b]));
  const queue = all.filter(c => c.status === 'needs_review').sort((a, b) => b.cost.total - a.cost.total);
  const total = queue.reduce((s, c) => s + c.cost.total, 0);

  const btn = 'rounded-md px-2.5 py-1 text-[12px] font-medium border';
  return (
    <>
      <PageTitle
        title={ru ? 'На проверку человеком' : 'Needs human review'}
        lead={ru ? 'Агент не был уверен: низкая уверенность, партия предположена без серийного номера или класс неясен. Ваше решение попадает в журнал и в книгу долга.' : 'The agent was not sure: low confidence, batch guessed without a serial, or unclear class. Your decision is audit-logged and updates the ledger.'}
        right={<div className="text-right"><div className="text-[13px] text-mute">{queue.length} {ru ? 'случаев на' : 'cases worth'}</div><Money v={total} className="text-[22px] font-semibold text-warn" /></div>}
      />
      <Panel>
        {queue.length === 0 ? (
          <Empty>{ru ? 'Очередь пуста. Агент справился со всеми случаями сам.' : 'Queue is empty. The agent handled every case on its own.'}</Empty>
        ) : (
          queue.map(c => (
            <CaseRow
              key={c.id}
              c={c}
              lang={lang}
              supplierCode={supById.get(c.supplierId ?? '')?.code}
              batchCode={batchById.get(c.batchId ?? '')?.code}
              actions={
                <>
                  <div className="text-[12px] text-mute mr-2">{ru ? 'Почему на проверке:' : 'Why in review:'} {c.reviewReasons.join('; ')}</div>
                  <form action={reviewCase}>
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="action" value="confirm" />
                    <button className={`${btn} accent-bg text-white border-transparent`}>{ru ? 'Подтвердить' : 'Confirm'}</button>
                  </form>
                  <form action={reviewCase} className="flex gap-1">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="action" value="reclassify" />
                    <select name="class" defaultValue={c.defectClass === 'manufacturing' ? 'installation' : 'manufacturing'} className="rounded-md border border-stone-300 bg-paper text-[12px] px-1.5">
                      <option value="manufacturing">{ru ? 'производственный' : 'manufacturing'}</option>
                      <option value="transport">{ru ? 'транспорт' : 'transport'}</option>
                      <option value="installation">{ru ? 'монтаж' : 'installation'}</option>
                    </select>
                    <button className={`${btn} border-stone-300 bg-paper hover:border-stone-400`}>{ru ? 'Переклассифицировать' : 'Reclassify'}</button>
                  </form>
                </>
              }
            />
          ))
        )}
      </Panel>
    </>
  );
}
