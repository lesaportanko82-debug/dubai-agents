import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel } from '@/components/ui';
import { Avatar } from '@/components/domovoy/Member';
import { impactMetrics } from '@core/domovoy/metrics';
import { learningReport } from '@core/domovoy/learning';
import type { AutonomyLevel } from '@core/domovoy/types';

export const dynamic = 'force-dynamic';

const LEVEL: Record<AutonomyLevel, { ru: string; en: string; color: string }> = {
  act: { ru: 'делаю сам', en: 'I handle it', color: 'var(--color-ok)' },
  ask: { ru: 'предлагаю', en: 'I propose', color: 'var(--color-warn)' },
  remind: { ru: 'напоминаю', en: 'I remind', color: 'var(--color-stone-300)' },
};

export default async function ImpactPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const lang = await getLang();
  const ru = lang === 'ru';
  const sp = await searchParams;
  const days = Math.min(90, Math.max(1, Number(sp.days ?? 7) || 7));
  const { store } = await panelContext();
  const now = new Date().toISOString();
  const [m, learning, members, approvals] = await Promise.all([impactMetrics(store, now, days), learningReport(store, lang), store.members(), store.approvals({ limit: 12 })]);
  const hours = Math.floor(m.estimatedMinutesSaved / 60), mins = m.estimatedMinutesSaved % 60;

  const tiles: { label: string; value: string; sub?: string }[] = [
    { label: ru ? 'Дел выполнено' : 'Tasks done', value: String(m.tasksDone), sub: `${m.minutesCoordinated} ${ru ? 'мин домашней работы' : 'min of housework'}` },
    { label: ru ? 'Без напоминаний' : 'Without a reminder', value: `${m.doneWithoutReminderPct}%`, sub: `${m.doneWithoutReminder} / ${m.tasksDone}` },
    { label: ru ? 'Агент сам' : 'Agent on its own', value: String(m.autonomousActions + m.swaps), sub: ru ? `${m.autonomousActions} действий · ${m.swaps} передач` : `${m.autonomousActions} actions · ${m.swaps} hand-overs` },
    { label: ru ? 'Доверие' : 'Trust', value: m.approvalsApproved + m.approvalsRejected ? `${m.approvalRatePct}%` : '—', sub: ru ? `одобрено ${m.approvalsApproved} из ${m.approvalsApproved + m.approvalsRejected} решений` : `${m.approvalsApproved} of ${m.approvalsApproved + m.approvalsRejected} decisions approved` },
    { label: ru ? 'Конфликтов предотвращено' : 'Conflicts prevented', value: String(m.conflictsPrevented), sub: ru ? `${m.loopsClosed} циклов закрыто с проверкой` : `${m.loopsClosed} loops closed with verification` },
    { label: ru ? 'Платежи по правилам' : 'Payments within rules', value: `${m.payments.paid} / ${m.payments.stoppedByRules}`, sub: ru ? `оплачено / остановлено · ${m.payments.spent} ${m.payments.currency}` : `paid / stopped · ${m.payments.spent} ${m.payments.currency}` },
    { label: ru ? 'Сэкономлено организатору' : 'Organiser time saved', value: `${hours ? hours + (ru ? ' ч ' : ' h ') : ''}${mins} ${ru ? 'мин' : 'min'}`, sub: ru ? 'оценка, допущения ниже' : 'estimate, assumptions below' },
  ];

  return (
    <>
      <PageTitle
        title={ru ? 'Эффект' : 'Impact'}
        lead={ru ? 'Что агент сделал сам, что спросил, что проверил — и сколько времени это сэкономило. Всё считается из журнала событий; оценка времени показана с допущениями.' : 'What the agent did on its own, what it asked, what it verified — and the time that saved. Everything is computed from the event log; the time estimate shows its assumptions.'}
        right={<div className="flex gap-1 text-[13px]">{[7, 30, 90].map(d => <a key={d} href={`?days=${d}`} className={`px-2 py-1 rounded ${d === days ? 'bg-stone-900 text-white' : 'bg-stone-100'}`}>{d} {ru ? 'дн' : 'd'}</a>)}</div>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {tiles.map(t => (
          <Panel key={t.label}><div className="px-5 py-4"><div className="text-[12px] uppercase tracking-wide text-mute">{t.label}</div><div className="num text-[30px] font-semibold leading-tight mt-1">{t.value}</div>{t.sub && <div className="text-[13px] text-mute mt-1">{t.sub}</div>}</div></Panel>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <Panel title={ru ? 'Чему научился' : 'What it has learned'}>
          <div className="px-5 pb-5 text-[14px]">
            <p className="text-mute text-[13px] mb-3">{learning.summary}</p>
            {learning.rows.length === 0 && <p className="text-mute">{ru ? 'Пока мало истории.' : 'Not much history yet.'}</p>}
            <ul className="space-y-3">
              {learning.rows.slice(0, 8).map(r => {
                const mem = members.find(x => x.id === r.executorId);
                return (
                  <li key={r.text} className="border-b border-stone-100 last:border-0 pb-3 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">{mem && <Avatar m={mem} size={22} />}<span className="truncate">«{r.text}»</span></div>
                      <span className="text-[12px] px-2 py-0.5 rounded-full text-white whitespace-nowrap" style={{ background: LEVEL[r.level].color }}>{ru ? LEVEL[r.level].ru : LEVEL[r.level].en} · {Math.round(r.confidence * 100)}%</span>
                    </div>
                    <div className="text-[13px] text-mute mt-1">{r.why}</div>
                    <div className="text-[12px] mt-1">{r.hint}</div>
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>

        <Panel title={ru ? 'Человеческие чекпоинты' : 'Human checkpoints'}>
          <div className="px-5 pb-5 text-[14px]">
            {approvals.length === 0 && <p className="text-mute">{ru ? 'Агент пока ничего не спрашивал.' : 'The agent has not asked for anything yet.'}</p>}
            <ul className="space-y-2">
              {approvals.map(a => (
                <li key={a.id} className="flex gap-3 py-1 border-b border-stone-100 last:border-0">
                  <span className="text-[12px] px-2 py-0.5 rounded-full bg-stone-100 h-fit whitespace-nowrap">{a.status}</span>
                  <div className="min-w-0"><div className="truncate">{ru ? a.reason.ru.split('\n')[0] : a.reason.en.split('\n')[0]}</div><div className="text-[12px] text-mute">{a.action} · {a.createdAt.slice(0, 16).replace('T', ' ')}{a.decidedBy ? ` · ${members.find(x => x.id === a.decidedBy)?.name ?? a.decidedBy}` : ''}</div></div>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>

      <Panel className="mt-5" title={ru ? 'По людям' : 'Per person'}>
        <div className="px-5 pb-5 text-[14px]">
          {m.perMember.map(p => {
            const mem = members.find(x => x.id === p.id)!;
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5 border-b border-stone-100 last:border-0">
                <div className="flex items-center gap-2 flex-1 min-w-[140px]"><Avatar m={mem} size={22} /><span>{p.name}</span></div>
                <div className="num text-right w-[64px]">{p.done} {ru ? 'дел' : 'done'}</div>
                <div className="num text-right w-[76px]">{p.minutes} {ru ? 'мин' : 'min'}</div>
                <div className="text-right text-[12px] w-[110px]">{p.autonomy ? <span className="px-2 py-0.5 rounded-full text-white" style={{ background: LEVEL[p.autonomy].color }}>{ru ? LEVEL[p.autonomy].ru : LEVEL[p.autonomy].en}</span> : <span className="text-mute">—</span>}</div>
              </div>
            );
          })}
          <p className="text-mute text-[12px] mt-4">
            {ru ? 'Допущения оценки времени: ' : 'Time-saved assumptions: '}
            {m.assumptions.perDispatchedTask} {ru ? 'мин за каждое распределённое дело' : 'min per dispatched task'}, {m.assumptions.perReminder} {ru ? 'за напоминание' : 'per reminder'}, {m.assumptions.perSwap} {ru ? 'за передачу после отказа' : 'per hand-over'}, {m.assumptions.perAutonomousAction} {ru ? 'за самостоятельное действие' : 'per autonomous action'}, {m.assumptions.perConflictPrevented} {ru ? 'за предотвращённый конфликт' : 'per prevented conflict'}.
          </p>
        </div>
      </Panel>
    </>
  );
}
