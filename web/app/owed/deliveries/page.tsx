import Link from 'next/link';
import { getLang } from '@/lib/lang';
import { owedView } from '@/lib/owed-view';
import { PageTitle, Panel } from '@/components/ui';
import { Stat, money, date } from '@/components/owed/Bits';
import { clauseFor } from '@core/owed/sqpm';

export const dynamic = 'force-dynamic';

export default async function DeliveriesPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const v = await owedView();
  const since = new Date(Date.parse(v.nowIso) - 180 * 86_400_000).toISOString().slice(0, 10);
  const rows = v.rows.map(r => ({ ...r, recent: r.ds.rows.filter(x => x.d.plannedAt >= since) }));
  const all = rows.flatMap(r => r.recent.filter(x => x.daysLate != null));
  const onTime = all.filter(x => x.bucket === 'on_time').length;
  const avg = all.length ? Math.round((10 * all.reduce((a, x) => a + (x.daysLate ?? 0), 0)) / all.length) / 10 : 0;
  const flagged = rows.filter(r => r.ds.lateInARow || r.ds.growing);
  const maxDelay = Math.max(10, ...rows.map(r => r.ds.avgDelay));
  const sq = (b: string) => (b === 'on_time' ? '#2F7D4F' : b === 'late_7' ? '#D69A2D' : b === 'late_more' ? '#C2412D' : '#D8DDD9');

  return (
    <>
      <PageTitle
        title={ru ? 'Дисциплина поставок' : 'Delivery discipline'}
        lead={ru
          ? 'Договорная, подтверждённая и фактическая дата каждой поставки. Агент считает опоздания с учётом допуска из договора, ставит риск-флаги и считает штраф по пункту договора — одной кнопкой он уходит в претензию.'
          : 'Contract, confirmed and actual date of each delivery. The agent counts delays net of the contract grace, raises risk flags and computes the contract penalty — one click adds it to a claim.'}
      />
      <Panel className="mb-5">
        <div className="px-5 py-5 grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <Stat label={ru ? 'Поставок за 180 дней' : 'Deliveries, 180 days'}>{all.length}</Stat>
          <Stat label={ru ? 'Пришли в срок' : 'On time'}><span className={onTime / Math.max(all.length, 1) < 0.7 ? 'text-warn' : ''}>{Math.round((100 * onTime) / Math.max(all.length, 1))}%</span></Stat>
          <Stat label={ru ? 'Среднее опоздание' : 'Average delay'}>{avg} {ru ? 'дн.' : 'd'}</Stat>
          <Stat label={ru ? 'Штраф к предъявлению' : 'Penalty to claim'}><span className="accent-text">{money(rows.reduce((a, r) => a + r.claimableDelivery, 0))}</span></Stat>
          <Stat label={ru ? 'Заводы с флагом' : 'Flagged factories'}><span className={flagged.length ? 'text-bad' : ''}>{flagged.length}</span></Stat>
        </div>
      </Panel>

      {flagged.map(r => {
        const pen = clauseFor(r.contract, 'delivery_penalty_pct_day');
        return (
          <div key={r.s.id} className="mb-3 rounded-card border border-amber-300 bg-amber-50/70 px-5 py-3 text-[14px]">
            <b>{ru ? 'Флаг' : 'Flag'}: {r.s.code} — {r.ds.lateInARow ? (ru ? '3 поставки подряд с опозданием' : '3 late deliveries in a row') : (ru ? 'опоздания растут' : 'delays growing')}.</b>{' '}
            {ru ? 'Среднее опоздание' : 'Average delay'} {r.ds.avgDelay} {ru ? 'дн. при допуске' : 'd with a grace of'} {r.terms.deliveryGraceDays} {ru ? 'дн.' : 'd'}{pen ? <> {ru ? 'По договору (п.' : 'Contract (cl.'} {pen.ref}) {ru ? 'штраф' : 'penalty'} {r.terms.deliveryPenaltyPctPerDay}% {ru ? 'в день от суммы поставки' : 'per day of the shipment value'}: {money(r.ds.penalty)}{r.claimableDelivery < r.ds.penalty ? (ru ? `, из них ещё не предъявлено ${money(r.claimableDelivery)}` : `, not yet claimed ${money(r.claimableDelivery)}`) : ''}.</> : <> {ru ? 'Пункт о штрафе не подтверждён — разберите договор.' : 'No confirmed penalty clause — analyse the contract.'}</>}
          </div>
        );
      })}

      <Panel className="mt-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[14px]">
            <thead className="text-[12px] text-mute text-left">
              <tr className="border-b border-stone-200">
                <th className="px-5 py-2 font-medium">{ru ? 'Завод' : 'Factory'}</th>
                <th className="px-2 py-2 font-medium text-right">{ru ? 'Поставок' : 'Deliveries'}</th>
                <th className="px-2 py-2 font-medium">{ru ? 'Последние 6 поставок' : 'Last 6 deliveries'}</th>
                <th className="px-2 py-2 font-medium text-right">{ru ? 'В срок' : 'On time'}</th>
                <th className="px-2 py-2 font-medium w-[18%]">{ru ? 'Среднее опоздание' : 'Average delay'}</th>
                <th className="px-2 py-2 font-medium text-right">{ru ? 'Штраф по договору' : 'Contract penalty'}</th>
                <th className="px-2 py-2 font-medium">{ru ? 'Статус' : 'Status'}</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const status = r.ds.lateInARow ? { t: ru ? '3 подряд' : '3 in a row', c: '#C2412D', bg: '#F7E4E4' } : r.ds.growing ? { t: ru ? 'растёт' : 'growing', c: '#9A5414', bg: '#FFF1DC' } : { t: ru ? 'в норме' : 'ok', c: '#2C5A2B', bg: '#E3F1E1' };
                return (
                  <tr key={r.s.id} className="border-b border-stone-100 last:border-0 align-middle">
                    <td className="px-5 py-3"><Link className="font-semibold hover:underline" href={`/owed/factories/${r.s.code}`}>{r.s.code}</Link> <span className="text-mute">{r.s.name.replace(' (demo)', '').split(' ').slice(0, 2).join(' ')}</span>{!r.contractReady && <div className="text-[11px] text-warn">{ru ? 'договор не разобран: допуск 0 дн.' : 'contract not analysed: 0-day grace'}</div>}</td>
                    <td className="px-2 py-3 num text-right">{r.ds.count}</td>
                    <td className="px-2 py-3">
                      <div className="flex gap-1">
                        {r.ds.last6.map(x => (
                          <span key={x.d.id} title={`${x.d.po}: ${ru ? 'по договору' : 'due'} ${date(x.d.plannedAt)}, ${ru ? 'подтверждено' : 'confirmed'} ${date(x.d.confirmedAt)}, ${ru ? 'факт' : 'actual'} ${x.d.actualAt ? date(x.d.actualAt) : ru ? 'в пути' : 'in transit'}`}
                            className="w-7 h-7 rounded-md text-white text-[11px] font-semibold flex items-center justify-center num" style={{ background: sq(x.bucket) }}>
                            {x.daysLate ? x.daysLate : x.daysLate === 0 ? '' : '…'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-3 num text-right">{r.ds.onTimePct}%</td>
                    <td className="px-2 py-3">
                      <div className="h-2 rounded-full bg-stone-100"><div className="h-2 rounded-full" style={{ width: `${(100 * r.ds.avgDelay) / maxDelay}%`, background: r.ds.avgDelay > 7 ? '#C2412D' : r.ds.avgDelay > r.terms.deliveryGraceDays ? '#D69A2D' : '#2F7D4F' }} /></div>
                      <div className="text-[12px] text-mute mt-1 num">{r.ds.avgDelay} {ru ? 'дн.' : 'd'}</div>
                    </td>
                    <td className="px-2 py-3 num text-right">{r.ds.penalty ? money(r.ds.penalty) : '—'}</td>
                    <td className="px-2 py-3"><span className="text-[12px] font-semibold rounded-md px-2 py-0.5" style={{ color: status.c, background: status.bg }}>{status.t}</span></td>
                    <td className="px-5 py-3 text-right">{r.claimableDelivery > 0 && <Link href={`/owed/claims?supplier=${r.s.code}`} className="rounded-md accent-bg text-white px-3 py-1.5 text-[13px] font-medium whitespace-nowrap">{ru ? 'В претензию' : 'Add to claim'}</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-stone-100 flex flex-wrap gap-4 text-[12px] text-mute">
          {[['#2F7D4F', ru ? 'в срок (с учётом допуска)' : 'on time (within grace)'], ['#D69A2D', ru ? 'опоздание до 7 дней' : 'up to 7 days late'], ['#C2412D', ru ? 'больше 7 дней (цифра — дни)' : 'more than 7 days (number = days)'], ['#D8DDD9', ru ? 'в пути' : 'in transit']].map(([c, t]) => <span key={t} className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: c }} />{t}</span>)}
          <span>· {ru ? 'Демо-данные' : 'Demo data'}</span>
        </div>
      </Panel>
    </>
  );
}
