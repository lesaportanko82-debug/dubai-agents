import Link from 'next/link';
import { getLang } from '@/lib/lang';
import { owedView } from '@/lib/owed-view';
import { PageTitle, Panel } from '@/components/ui';
import { RateBar, money, date } from '@/components/owed/Bits';
import { DEFECT_RU, directDamage } from '@core/owed/sqpm';
import { PRODUCTS } from '@core/owed/fixtures';

export const dynamic = 'force-dynamic';

export default async function BatchesPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const v = await owedView();
  const all = v.rows.flatMap(r => r.lines.map(x => ({ ...x, s: r.s, contract: r.contract })));
  const skus = Array.from(new Set(all.map(x => x.b.sku))).sort();
  const over = all.filter(x => x.line.overAllowance);
  const maxPct = Math.max(4, ...all.map(x => x.line.pct * 1.15), ...all.map(x => x.line.allowedPct * 1.3));

  const topDefect = (batchId: string) => {
    const m = new Map<string, number>();
    for (const c of v.cases.filter(c => c.batchId === batchId && c.defectClass === 'manufacturing' && c.defectCode)) m.set(c.defectCode!, (m.get(c.defectCode!) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };

  return (
    <>
      <PageTitle
        title={ru ? 'Качество партий' : 'Batch quality'}
        lead={ru
          ? '% брака = подтверждённые дефекты (уровни A/B) / проданные единицы партии — а не число жалоб. Порог — из договора конкретного завода, со ссылкой на пункт.'
          : 'Defect rate = confirmed defects (levels A/B) / units sold from the batch — not the number of complaints. The allowance comes from that factory’s contract, with its clause.'}
      />

      {over.length > 0 && (
        <div className="mb-6 rounded-card border border-amber-300 bg-amber-50/70 px-5 py-4 text-[14px]">
          <div className="font-semibold mb-2">{ru ? `Выше договорного порога: ${over.length} ${over.length === 1 ? 'партия' : 'партии'}` : `Above the contract allowance: ${over.length}`}</div>
          <ul className="space-y-2">
            {over.map(x => {
              const code = topDefect(x.b.id);
              return (
                <li key={x.b.id}>
                  <b>{x.b.code}</b> ({x.b.sku}, {x.s.code}): {x.line.pct}% {ru ? 'при допуске' : 'vs'} {x.line.allowedPct}% ({ru ? 'п.' : 'cl.'} {x.line.clauseRef ?? '—'}) · {ru ? 'прямой ущерб' : 'direct damage'} {x.line.cases} × ${x.b.unitCost} = <b>{money(directDamage(x.b, x.line.cases))}</b>.{' '}
                  <span className="text-mute">{ru ? 'Черновик чек-листа инспекции следующей поставки' : 'Draft inspection checklist for the next shipment'}: {code ? (ru ? `проверка «${DEFECT_RU[code]}», ` : `check "${code}", `) : ''}{ru ? 'тест на протечку под давлением, контроль покрытия и резьбы на 100% образцов AQL 1.0.' : 'pressure leak test, coating and thread control on 100% of AQL 1.0 samples.'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {skus.map(sku => {
        const rows = all.filter(x => x.b.sku === sku).sort((a, b) => a.b.shippedAt.localeCompare(b.b.shippedAt));
        const factories = Array.from(new Set(rows.map(x => x.s.code)));
        return (
          <Panel key={sku} className="mb-5" title={`${sku} · ${PRODUCTS[sku]?.[lang] ?? ''}`} aside={factories.length > 1 ? <span className="text-[12px] rounded-md px-2 py-0.5 bg-info-wash text-info font-medium">{ru ? `делают ${factories.length} завода: ${factories.join(', ')}` : `made by ${factories.length} factories: ${factories.join(', ')}`}</span> : undefined}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-[14px]">
                <thead className="text-[12px] text-mute text-left">
                  <tr className="border-b border-stone-200">
                    <th className="px-5 py-2 font-medium">{ru ? 'Партия' : 'Batch'}</th>
                    <th className="px-2 py-2 font-medium">{ru ? 'Завод' : 'Factory'}</th>
                    <th className="px-2 py-2 font-medium">{ru ? 'Отгружено' : 'Shipped'}</th>
                    <th className="px-2 py-2 font-medium text-right">{ru ? 'Закуплено / продано' : 'Bought / sold'}</th>
                    <th className="px-2 py-2 font-medium text-right">{ru ? 'Подтв. брак' : 'Confirmed'}</th>
                    <th className="px-2 py-2 font-medium w-[34%]">{ru ? 'Доля брака и допуск по договору' : 'Rate vs contract allowance'}</th>
                    <th className="px-5 py-2 font-medium text-right">{ru ? 'Прямой ущерб' : 'Direct damage'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(x => (
                    <tr key={x.b.id} className="border-b border-stone-100 last:border-0">
                      <td className="px-5 py-3 font-semibold"><Link className="hover:underline" href={`/owed/cases?batch=${x.b.code}`}>{x.b.code}</Link>{x.line.overAllowance && <span className="ml-1.5 text-bad" title={ru ? 'выше нормы' : 'over'}>●</span>}</td>
                      <td className="px-2 py-3"><Link className="hover:underline" href={`/owed/factories/${x.s.code}`}>{x.s.code}</Link></td>
                      <td className="px-2 py-3 num">{date(x.b.shippedAt)}</td>
                      <td className="px-2 py-3 num text-right">{x.b.qty.toLocaleString('en-US')} / {(x.b.soldUnits ?? x.b.qty).toLocaleString('en-US')}</td>
                      <td className="px-2 py-3 num text-right">{x.line.cases}</td>
                      <td className="px-2 py-3">
                        <RateBar pct={x.line.pct} allowed={x.line.allowedPct} max={maxPct} />
                        <div className="text-[12px] text-mute mt-1 num">{x.line.pct}% · {ru ? 'допуск' : 'allowed'} {x.line.allowedPct}% ({ru ? 'п.' : 'cl.'} {x.line.clauseRef ?? '—'})</div>
                      </td>
                      <td className="px-5 py-3 num text-right">{money(directDamage(x.b, x.line.cases))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        );
      })}
      <p className="text-[12px] text-mute">{ru ? 'Прямой ущерб — подтверждённые дефекты × себестоимость. Сумма претензии считается отдельно по формуле договора (все случаи или только сверх порога, плюс логистика и сервис).' : 'Direct damage = confirmed defects × unit cost. The claim amount follows the contract formula (all cases or only those above the allowance, plus logistics and service).'}</p>
    </>
  );
}
