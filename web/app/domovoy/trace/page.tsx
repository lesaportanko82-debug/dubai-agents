import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Empty } from '@/components/ui';
import { TraceRail } from '@/components/TraceRail';
import { Avatar } from '@/components/domovoy/Member';

export const dynamic = 'force-dynamic';

const EVENT: Record<string, { ru: string; en: string }> = {
  created: { ru: 'создано', en: 'created' }, assigned: { ru: 'назначено', en: 'assigned' }, accepted: { ru: 'принято', en: 'accepted' }, declined: { ru: 'отказ', en: 'declined' },
  swapped: { ru: 'передано другому', en: 'swapped' }, rescheduled: { ru: 'перенесено', en: 'rescheduled' }, timeout: { ru: 'нет ответа → отказ', en: 'no reply → decline' }, proof_requested: { ru: 'запрошено фото', en: 'photo requested' }, auto_replaced: { ru: 'срочное, заменён', en: 'urgent, replaced' }, reminded: { ru: 'напоминание', en: 'reminded' }, done: { ru: 'сделано', en: 'done' }, blocked: { ru: 'исключён', en: 'ruled out' }, message: { ru: 'сообщение', en: 'message' },
  approval_requested: { ru: 'запрос решения', en: 'approval requested' }, approval_decided: { ru: 'решение принято', en: 'approval decided' }, autonomous_action: { ru: 'агент сделал сам', en: 'autonomous action' },
  verification_asked: { ru: 'проверка: сделано?', en: 'verification asked' }, verified: { ru: 'подтверждено', en: 'verified' }, loop_closed: { ru: 'цикл закрыт', en: 'loop closed' }, info: { ru: 'служебное', en: 'info' },
};

export default async function TracePage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store, runs } = await panelContext();
  const [members, tasks, events] = await Promise.all([store.members(), store.tasks(), store.events()]);
  const byId = new Map(members.map(m => [m.id, m]));
  const taskText = (id: string) => tasks.find(t => t.id === id)?.text ?? id;
  const recent = [...events].reverse().slice(0, 40);

  return (
    <>
      <PageTitle title={ru ? 'Как решал агент' : 'Agent decisions'} lead={ru ? 'Каждое решение с объяснением. Слева — прогоны (что сказали Домовёнку и что он сделал), справа — журнал событий по делам.' : 'Every decision with its reason. Left: runs (what Domovoy was told and what it did). Right: the event log per task.'} />
      <div className="grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 items-start">
        <div className="space-y-5">
          {runs.length === 0 && <Panel><Empty>{ru ? 'Прогонов пока нет. Отправьте сообщение в разделе «Попробовать».' : 'No runs yet. Send a message in “Try it”.'}</Empty></Panel>}
          {runs.slice(0, 5).map(r => (
            <Panel key={r.id}>
              <div className="px-5 pt-4 pb-3 border-b border-stone-100 text-[14px]">
                <span className="text-mute">{r.at.slice(11, 16)} · {byId.get(r.authorId)?.name}:</span> «{r.input}»
              </div>
              <div className="px-5 py-4"><TraceRail steps={r.result.trace} lang={lang} summary={r.result.summary} animate={false} /></div>
            </Panel>
          ))}
        </div>
        <Panel title={ru ? 'Журнал событий' : 'Event log'}>
          <ul className="px-5 pb-4 divide-y divide-stone-100 text-[13px]">
            {recent.length === 0 && <li className="py-6 text-mute text-center">—</li>}
            {recent.map((e, i) => {
              const m = byId.get(e.actor);
              return (
                <li key={i} className="py-2 flex items-start gap-2">
                  <span className="num text-mute w-[42px] shrink-0">{e.at.slice(11, 16)}</span>
                  {m ? <Avatar m={m} size={20} /> : <span className="inline-flex w-5 h-5 rounded-full accent-bg text-white text-[10px] items-center justify-center shrink-0">Д</span>}
                  <span className="min-w-0">
                    <b>{EVENT[e.type]?.[lang] ?? e.type}</b> · {taskText(e.taskId)}
                    {e.details && <span className="text-mute"> · {Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ').slice(0, 120)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </>
  );
}
