import { domovoyState } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel } from '@/components/ui';
import { Avatar, memberColor, ROLE_LABEL } from '@/components/domovoy/Member';
import { weeklyReport } from '@core/domovoy/household';

export const dynamic = 'force-dynamic';

export default async function FairnessPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store } = domovoyState();
  const members = await store.members();
  const { rows, suggestion } = await weeklyReport(store, new Date().toISOString(), lang);
  const max = Math.max(...rows.map(r => r.minutes), 1);
  const adults = rows.filter(r => r.role === 'adult');
  const kids = rows.filter(r => r.role === 'child');

  return (
    <>
      <PageTitle
        title={ru ? 'Справедливость' : 'Fairness'}
        lead={ru ? 'Невидимая работа дома — в минутах. Отчёт приходит всей семье по воскресеньям: без упрёков, только цифры и одно предложение, как выровнять.' : 'Invisible household work, in minutes. The whole family gets this on Sundays: no blame, just numbers and one suggestion to rebalance.'}
      />
      <Panel className="mb-5">
        <div className="px-5 py-5">
          <div className="text-[13px] text-mute mb-3">{ru ? 'Минуты дел за эту неделю' : 'Minutes of chores this week'}</div>
          <ul className="space-y-3">
            {rows.sort((a, b) => b.minutes - a.minutes).map(r => {
              const m = members.find(x => x.id === r.memberId)!;
              return (
                <li key={r.memberId} className="grid grid-cols-[140px_1fr_90px] items-center gap-3">
                  <div className="flex items-center gap-2"><Avatar m={m} size={26} /><span className="text-[14px] font-medium truncate">{r.name.replace('Бабушка ', '')}</span></div>
                  <div className="h-5 rounded bg-stone-100"><div className="h-full rounded" style={{ width: `${(100 * r.minutes) / max}%`, background: memberColor(r.memberId) }} /></div>
                  <div className="num text-right text-[14px]"><b>{r.minutes}</b> <span className="text-mute">{ru ? 'мин' : 'min'} · {r.tasks}</span></div>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 rounded-md accent-wash px-4 py-3 text-[14px]"><b>{ru ? 'Домовёнок предлагает: ' : 'Domovoy suggests: '}</b>{suggestion}</div>
        </div>
      </Panel>
      <div className="grid md:grid-cols-2 gap-5">
        <Panel title={ru ? 'Баланс между взрослыми' : 'Balance between adults'}>
          <div className="px-5 pb-5 text-[14px]">
            {adults.map(a => <div key={a.memberId} className="flex justify-between py-1 border-b border-stone-100 last:border-0"><span>{a.name}</span><span className="num">{a.minutes} {ru ? 'мин' : 'min'}</span></div>)}
            <p className="text-mute text-[13px] mt-3">{ru ? 'Часы помощницы — оплачиваемая работа, они считаются отдельно и не входят в баланс.' : 'The helper’s hours are paid work; they are counted separately and not part of the balance.'}</p>
          </div>
        </Panel>
        <Panel title={ru ? 'Очки детей' : 'Children’s points'}>
          <div className="px-5 pb-5 text-[14px]">
            {kids.map(k => <div key={k.memberId} className="flex justify-between py-1 border-b border-stone-100 last:border-0"><span>{k.name}</span><span className="num">⭐ {k.points}</span></div>)}
            <p className="text-mute text-[13px] mt-3">{ru ? 'Каждому ребёнку показываются только его очки. Сравнений между детьми нет.' : 'Each child sees only their own points. No comparison between children.'}</p>
          </div>
        </Panel>
      </div>
    </>
  );
}
