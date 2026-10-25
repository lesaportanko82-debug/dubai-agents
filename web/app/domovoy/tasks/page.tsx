import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Pill } from '@/components/ui';
import { Avatar } from '@/components/domovoy/Member';
import { hhmm } from '@core/domovoy/household';
import { reasonText } from '@/lib/reasons';
import type { Task } from '@core/domovoy/types';
import { respondAction, doneAction, tickAction } from '../actions';

export const dynamic = 'force-dynamic';

const COLS: { key: string; statuses: Task['status'][]; ru: string; en: string }[] = [
  { key: 'open', statuses: ['new', 'unassigned'], ru: 'Ждут исполнителя', en: 'Needs someone' },
  { key: 'assigned', statuses: ['assigned'], ru: 'Назначено, ждём «ок»', en: 'Assigned, awaiting ok' },
  { key: 'accepted', statuses: ['accepted'], ru: 'В работе', en: 'In progress' },
  { key: 'done', statuses: ['done'], ru: 'Сделано', en: 'Done' },
];

export default async function TasksPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store } = await panelContext();
  const [members, tasks] = await Promise.all([store.members(), store.tasks()]);
  const byId = new Map(members.map(m => [m.id, m]));
  const btn = 'rounded-md px-2 py-1 text-[12px] font-medium border';

  return (
    <>
      <PageTitle
        title={ru ? 'Доска дел' : 'Task board'}
        lead={ru ? 'Кнопки — это ответы членов семьи из их мессенджера; здесь их можно нажать за них. Молчание дольше 45 минут агент считает отказом; срочное дело без «ок» за 20 минут до срока он передаёт сам.' : 'The buttons stand for family members’ replies from their messenger; press them here on their behalf. Silence over 45 minutes counts as a decline; an urgent task without an “ok” 20 minutes before due is handed over automatically.'}
        right={
          <form action={tickAction} className="flex items-center gap-2 text-[13px]">
            <span className="text-mute">{ru ? 'Промотать время:' : 'Skip time:'}</span>
            {[20, 60, 120].map(m => <button key={m} name="plusMin" value={m} className={`${btn} border-stone-300 bg-paper hover:border-stone-400`}>+{m} {ru ? 'мин' : 'min'}</button>)}
          </form>
        }
      />
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
        {COLS.map(col => {
          const items = tasks.filter(t => col.statuses.includes(t.status)).sort((a, b) => (b.dueAt ?? b.createdAt).localeCompare(a.dueAt ?? a.createdAt));
          return (
            <Panel key={col.key} title={`${col[lang]} · ${items.length}`}>
              <ul className="px-3 pb-3 space-y-2">
                {items.length === 0 && <li className="text-mute text-[13px] px-2 py-4">—</li>}
                {items.slice(0, 12).map(t => {
                  const m = t.assigneeId ? byId.get(t.assigneeId) : undefined;
                  return (
                    <li key={t.id} className="rounded-md border border-stone-200 bg-paper p-3 text-[13px]">
                      <div className="font-medium text-[14px] leading-snug">{t.text}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-mute">
                        {t.dueAt && <span className="num">{hhmm(t.dueAt)}</span>}
                        <span>{t.minutes} {ru ? 'мин' : 'min'}</span>
                        {t.kidSafe && <Pill tone="accent">{ru ? 'для ребёнка' : 'kid-safe'}</Pill>}
                        {t.urgent && <Pill tone="bad">{ru ? 'срочное' : 'urgent'}</Pill>}
                        {t.needsProof && <Pill tone="info">{ru ? 'нужно фото' : 'photo required'}</Pill>}
                        {t.rescheduledFrom && <span title={ru ? 'перенесено' : 'rescheduled'}>↷ {hhmm(t.rescheduledFrom)}</span>}
                        {t.reminderLevel > 0 && <span title={ru ? 'уровень напоминания' : 'reminder level'}>{'●'.repeat(t.reminderLevel)}{'○'.repeat(3 - t.reminderLevel)}</span>}
                      </div>
                      {m && (
                        <div className="mt-2 flex items-center gap-2">
                          <Avatar m={m} size={22} />
                          <span className="font-medium">{m.name}</span>
                          {t.assignReason && <span className="text-mute truncate" title={reasonText(t.assignReason, lang)}>· {reasonText(t.assignReason, lang)}</span>}
                        </div>
                      )}
                      {t.status === 'unassigned' && <div className="mt-2 text-bad">{ru ? 'Никто не может взять. Отказались: ' : 'Nobody can take it. Declined: '}{t.declinedBy.map(id => byId.get(id)?.name).join(', ')}</div>}
                      {m && t.status === 'assigned' && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <form action={respondAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="memberId" value={m.id} /><button name="answer" value="accept" className={`${btn} accent-bg text-white border-transparent`}>{ru ? 'ок' : 'ok'}</button></form>
                          <form action={respondAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="memberId" value={m.id} /><button name="answer" value="decline" className={`${btn} border-stone-300 bg-paper`}>{ru ? 'не могу' : "can't"}</button></form>
                          {!t.urgent && (
                            <form action={respondAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="memberId" value={m.id} /><input type="hidden" name="proposeInMin" value="120" /><button name="answer" value="decline" className={`${btn} border-stone-300 bg-paper`} title={ru ? 'отказ с предложением времени' : 'decline with a proposed time'}>{ru ? 'могу через 2 ч' : 'can in 2 h'}</button></form>
                          )}
                        </div>
                      )}
                      {m && t.status === 'accepted' && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <form action={doneAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="memberId" value={m.id} /><button className={`${btn} accent-bg text-white border-transparent`}>{ru ? 'готово' : 'done'}</button></form>
                          {t.needsProof && <form action={doneAction}><input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="memberId" value={m.id} /><input type="hidden" name="photo" value="1" /><button className={`${btn} border-stone-300 bg-paper`}>{ru ? 'готово + фото' : 'done + photo'}</button></form>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
