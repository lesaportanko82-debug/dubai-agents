import { owedContext } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Empty } from '@/components/ui';
import { CaseRow } from '@/components/owed/CaseRow';
import { CLASS, money } from '@/components/owed/Bits';
import { reviewCase } from '../actions';
import type { DefectCase } from '@core/owed/types';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const lang = await getLang();
  const ru = lang === 'ru';
  const sp = await searchParams;
  const { store, role } = await owedContext();
  const [suppliers, batches, all] = await Promise.all([store.suppliers(), store.batches(), store.cases()]);
  const supCode = (id?: string) => suppliers.find(s => s.id === id)?.code;
  const batchCode = (id?: string) => batches.find(b => b.id === id)?.code;
  const byDate = (a: DefectCase, b: DefectCase) => b.receivedAt.localeCompare(a.receivedAt);
  const unsure = all.filter(c => c.status === 'needs_review').sort(byDate);
  const levelC = all.filter(c => c.status === 'analytics_only').sort(byDate);
  const levelD = all.filter(c => c.status === 'awaiting_label').sort(byDate);
  const mayReview = role === 'quality' || role === 'service' || role === 'buyer';
  const btn = 'rounded-md px-3 py-1.5 text-[13px] font-medium';

  const labelForm = (c: DefectCase) => (
    <form action={reviewCase} className="mt-2 flex flex-wrap gap-2 items-center">
      <input type="hidden" name="id" value={c.id} />
      <input type="hidden" name="action" value="label" />
      <label className="text-[12px] text-mute" htmlFor={`b-${c.id}`}>{ru ? 'Партия с фото этикетки' : 'Batch from the label photo'}</label>
      <input id={`b-${c.id}`} name="batch" placeholder="B-2026-084" className="w-[130px] rounded-md border border-stone-300 bg-paper px-2 py-1 text-[13px]" />
      <button className={`${btn} accent-bg text-white`} disabled={!mayReview}>{ru ? 'Привязать → A' : 'Attach → A'}</button>
    </form>
  );

  return (
    <>
      <PageTitle
        title={ru ? 'На проверку человеком' : 'Human review'}
        lead={ru
          ? 'Претензию заводу предъявляем только на уровнях A и B и только после проверки человеком. Здесь — всё, где агент не уверен или не хватает данных о партии.'
          : 'A factory is only claimed at levels A and B, and only after a person checks. Here is everything where the agent is unsure or the batch is missing.'}
        right={<div className="text-right"><div className="text-[13px] text-mute">{ru ? 'Всего в очередях' : 'In the queues'}</div><div className="num text-[26px] font-semibold">{unsure.length + levelC.length + levelD.length}</div></div>}
      />
      {!mayReview && <p className="mb-4 text-[13px] text-warn">{ru ? 'Ваша роль только просматривает. Проверяют качество, СЦ и закупщик.' : 'Your role is read-only here. Quality, service and buyers review.'}</p>}
      {sp.error && <p className="mb-4 text-[13px] text-bad">{ru ? `Партия «${sp.error}» не найдена в закупках.` : `Batch "${sp.error}" not found in purchases.`}</p>}

      <Panel className="mb-6" title={ru ? `Агент не уверен · ${unsure.length} · ${money(unsure.reduce((a, c) => a + c.cost.total, 0))}` : `Agent is unsure · ${unsure.length}`}>
        {unsure.length === 0 ? <Empty>{ru ? 'Очередь пуста.' : 'Queue is empty.'}</Empty> : unsure.map(c => (
          <CaseRow key={c.id} c={c} lang={lang} supplierCode={supCode(c.supplierId)} batchCode={batchCode(c.batchId)}>
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <form action={reviewCase}>
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="action" value="confirm" />
                <button className={`${btn} accent-bg text-white`} disabled={!mayReview}>{ru ? 'Подтвердить' : 'Confirm'}</button>
              </form>
              <form action={reviewCase} className="flex gap-2">
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="action" value="reclassify" />
                <label className="sr-only" htmlFor={`cls-${c.id}`}>{ru ? 'Класс' : 'Class'}</label>
                <select id={`cls-${c.id}`} name="class" defaultValue={c.defectClass === 'manufacturing' ? 'installation' : 'manufacturing'} className="rounded-md border border-stone-300 bg-paper px-2 py-1 text-[13px]">
                  {(['manufacturing', 'transport', 'installation'] as const).map(k => <option key={k} value={k}>{CLASS[k][lang]}</option>)}
                </select>
                <button className={`${btn} border border-stone-300 bg-paper`} disabled={!mayReview}>{ru ? 'Переклассифицировать' : 'Reclassify'}</button>
              </form>
            </div>
          </CaseRow>
        ))}
      </Panel>

      <Panel className="mb-6" title={ru ? `Уровень C — несколько возможных заводов · ${levelC.length}` : `Level C — several possible factories · ${levelC.length}`}>
        <p className="px-5 -mt-1 mb-2 text-[13px] text-mute">{ru ? 'Заказ ушёл со склада, когда там были партии двух заводов. В претензию не идёт — только в аналитику, пока клиент не пришлёт фото этикетки.' : 'The order shipped while two factories had stock. Not claimable — analytics only until the customer sends a label photo.'}</p>
        {levelC.length === 0 ? <Empty>—</Empty> : levelC.map(c => (
          <CaseRow key={c.id} c={c} lang={lang} candidates={(c.candidateSupplierIds ?? []).map(id => supCode(id) ?? id)}>
            <div className="flex flex-wrap gap-2 items-center">
              {labelForm(c)}
              <form action={reviewCase} className="mt-2">
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="action" value="request_label" />
                <button className={`${btn} border border-stone-300 bg-paper`} disabled={!mayReview}>{ru ? 'Запросить фото этикетки' : 'Ask for a label photo'}</button>
              </form>
            </div>
          </CaseRow>
        ))}
      </Panel>

      <Panel title={ru ? `Уровень D — ждём фото этикетки · ${levelD.length}` : `Level D — waiting for the label photo · ${levelD.length}`}>
        <p className="px-5 -mt-1 mb-2 text-[13px] text-mute">{ru ? 'Нет ни серии, ни заказа, ни модели. Бот уже попросил клиента прислать фото этикетки; когда оно придёт — впишите номер партии.' : 'No serial, order or model. The bot already asked for a label photo; enter the batch when it arrives.'}</p>
        {levelD.length === 0 ? <Empty>—</Empty> : levelD.map(c => (
          <CaseRow key={c.id} c={c} lang={lang}>
            {c.labelRequestedAt && <div className="mt-1 text-[12px] text-mute">{ru ? 'Запрос отправлен' : 'Requested'} {c.labelRequestedAt.slice(0, 10)}</div>}
            {labelForm(c)}
          </CaseRow>
        ))}
      </Panel>
    </>
  );
}
