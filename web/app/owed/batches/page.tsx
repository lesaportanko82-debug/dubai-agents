import { owedState } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { detectSpikes } from '@core/owed/tools/spikes';
import { PageTitle, Panel, Pill } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function BatchesPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store } = owedState();
  const [suppliers, batches, cases] = await Promise.all([store.suppliers(), store.batches(), store.cases()]);
  const rates = detectSpikes(batches, suppliers, cases).sort((a, b) => b.pct - a.pct);
  const maxPct = Math.max(...rates.map(r => Math.max(r.pct, r.allowedPct)), 0.1);
  const alerts = rates.filter(r => r.alert);

  return (
    <>
      <PageTitle
        title={ru ? 'Партии и всплески брака' : 'Batches & defect spikes'}
        lead={ru ? 'Доля производственного брака по каждой партии против допуска в контракте и против других партий того же артикула. Всплеск означает: инспекция следующей поставки и пункт в переговорный пакет.' : 'Manufacturing-defect rate per batch vs the contract allowance and vs other batches of the same SKU. A spike means: inspect the next shipment and add a clause to the negotiation pack.'}
      />

      {alerts.length > 0 && (
        <div className="mb-5 rounded-card border border-warn/40 bg-warn-wash px-5 py-4">
          <div className="font-semibold text-warn mb-1">{ru ? `Внимание: ${alerts.length} ${alerts.length === 1 ? 'партия' : 'партии'} выше нормы` : `Attention: ${alerts.length} ${alerts.length === 1 ? 'batch' : 'batches'} above the norm`}</div>
          <ul className="text-[14px] space-y-1">
            {alerts.map(a => (
              <li key={a.batch.id}>
                <b>{a.batch.code}</b> ({a.batch.sku}, {a.supplier.code}): {a.alertReason}.{' '}
                <span className="text-ink-soft">{ru ? 'Черновик чек-листа инспекции: тест на протечку картриджа, контроль покрытия, проверка резьбы на 100% образцов AQL 1.0.' : 'Inspection checklist draft: cartridge leak test, coating check, thread gauge on AQL 1.0 samples.'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Panel>
        <table className="w-full text-[14px]">
          <thead className="text-[12px] text-mute">
            <tr className="border-b border-stone-200">
              <th className="text-left font-medium px-5 py-3">{ru ? 'Партия' : 'Batch'}</th>
              <th className="text-left font-medium py-3">{ru ? 'Артикул' : 'SKU'}</th>
              <th className="text-left font-medium py-3">{ru ? 'Завод' : 'Factory'}</th>
              <th className="text-right font-medium py-3">{ru ? 'Отгружено' : 'Shipped'}</th>
              <th className="text-right font-medium py-3">{ru ? 'Штук' : 'Qty'}</th>
              <th className="text-right font-medium py-3">{ru ? 'Произв. брак' : 'Mfg cases'}</th>
              <th className="text-left font-medium py-3 pl-6 w-[34%]">{ru ? 'Доля брака vs допуск' : 'Rate vs allowance'}</th>
              <th className="text-right font-medium py-3 pr-5">{ru ? 'К базовой' : 'vs baseline'}</th>
            </tr>
          </thead>
          <tbody>
            {rates.map(r => (
              <tr key={r.batch.id} className="border-b border-stone-100 last:border-0">
                <td className="px-5 py-3 font-semibold">{r.batch.code}{r.alert && <Pill tone="warn">!</Pill>}</td>
                <td className="py-3">{r.batch.sku}</td>
                <td className="py-3 accent-text font-medium">{r.supplier.code}</td>
                <td className="py-3 text-right num text-mute">{r.batch.shippedAt}</td>
                <td className="py-3 text-right num">{r.batch.qty.toLocaleString('en-US')}</td>
                <td className="py-3 text-right num">{r.manufacturingCases}</td>
                <td className="py-3 pl-6">
                  <div className="relative h-3 rounded-sm bg-stone-100">
                    <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${(100 * r.pct) / maxPct}%`, background: r.alert ? 'var(--color-warn)' : 'var(--accent)' }} />
                    <div className="absolute -top-1 -bottom-1 w-px bg-ink" style={{ left: `${(100 * r.allowedPct) / maxPct}%` }} title={`${ru ? 'допуск' : 'allowance'} ${r.allowedPct}%`} />
                  </div>
                  <div className="text-[12px] text-mute mt-1 num">{r.pct}% · {ru ? 'допуск' : 'allowance'} {r.allowedPct}%</div>
                </td>
                <td className="py-3 pr-5 text-right num">{r.vsSkuBaseline === null ? '—' : `${r.vsSkuBaseline}×`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
