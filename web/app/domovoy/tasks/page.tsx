import Link from 'next/link';
import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { memberColor } from '@/components/domovoy/Member';
import { hhmm } from '@core/domovoy/household';
import { reasonText } from '@/lib/reasons';
import type { Member, Task } from '@core/domovoy/types';
import { respondAction, doneAction, tickAction, rescheduleAction, cancelAction } from '../actions';

export const dynamic = 'force-dynamic';

type Lang = 'ru' | 'en';
const OPEN: Task['status'][] = ['new', 'unassigned', 'assigned', 'accepted'];
const short = (m: Member) => m.name.replace(/^(Бабушка|Дедушка)\s+/, '');
const initial = (m: Member) => short(m).slice(0, 1).toUpperCase();
const dueMs = (t: Task) => Date.parse(t.dueAt ?? t.createdAt);

const STATUS_COLS: { key: string; statuses: Task['status'][]; ru: string; en: string }[] = [
  { key: 'open', statuses: ['new', 'unassigned'], ru: 'Ждут исполнителя', en: 'Needs someone' },
  { key: 'assigned', statuses: ['assigned'], ru: 'Ждём «ок»', en: 'Awaiting ok' },
  { key: 'accepted', statuses: ['accepted'], ru: 'В работе', en: 'In progress' },
  { key: 'done', statuses: ['done'], ru: 'Сделано', en: 'Done' },
];

const btnPrimary = 'min-h-[40px] px-4 rounded-xl text-[14px] font-semibold text-white';
const btnGhost = 'min-h-[40px] px-3.5 rounded-xl text-[14px] font-semibold border bg-white';

function Chip({ children, tone }: { children: React.ReactNode; tone: 'hearth' | 'rose' | 'blue' | 'mute' }) {
  const c = { hearth: ['#FFF1DD', '#7A4510'], rose: ['#F7E4EB', '#7A2A47'], blue: ['#E3EEF4', '#1D4A61'], mute: ['#EEF1EE', '#33443D'] }[tone];
  return <span className="text-[12px] font-semibold rounded-lg px-2 py-0.5 whitespace-nowrap" style={{ background: c[0], color: c[1] }}>{children}</span>;
}

/** One task, with the buttons that stand for its assignee's replies in Telegram. */
function TaskCard({ t, m, byId, lang, nowMs, showWho }: { t: Task; m?: Member; byId: Map<string, Member>; lang: Lang; nowMs: number; showWho?: boolean }) {
  const ru = lang === 'ru';
  const late = t.dueAt && Date.parse(t.dueAt) < nowMs && OPEN.includes(t.status);
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  return (
    <li className="rounded-2xl p-4 flex flex-col gap-2.5" style={{ background: t.status === 'done' ? 'transparent' : '#FFFFFF', border: '1px solid var(--dm-line)' }}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-snug" style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--color-mute)' : undefined }}>{t.text}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-mute">
            {t.dueAt && <span className="num">{hhmm(t.dueAt)}</span>}
            <span>· {t.minutes} {ru ? 'мин' : 'min'}</span>
            {t.status === 'assigned' && <Chip tone="blue">{ru ? 'ждём «ок»' : 'awaiting ok'}</Chip>}
            {t.status === 'accepted' && <Chip tone="mute">{ru ? 'в работе' : 'in progress'}</Chip>}
            {late && <Chip tone="hearth">{ru ? 'просрочено' : 'late'}</Chip>}
            {t.urgent && <Chip tone="rose">{ru ? 'срочно' : 'urgent'}</Chip>}
            {t.kidSafe && <Chip tone="mute">{ru ? 'для ребёнка' : 'kid-safe'}</Chip>}
            {t.needsProof && <Chip tone="blue">{ru ? 'нужно фото' : 'photo'}</Chip>}
            {t.private && <Chip tone="mute">{ru ? 'приватное' : 'private'}</Chip>}
            {t.rescheduledFrom && <span>{ru ? 'перенесено с' : 'moved from'} {hhmm(t.rescheduledFrom)}</span>}
            {t.reminderLevel > 0 && <span>{ru ? `напоминаний: ${t.reminderLevel}` : `reminders: ${t.reminderLevel}`}</span>}
          </div>
        </div>
        {showWho && m && <span aria-hidden="true" className="w-8 h-8 rounded-full text-white text-[14px] font-bold flex items-center justify-center shrink-0" style={{ background: memberColor(m.id) }}>{initial(m)}</span>}
      </div>
      {t.assignReason && t.status !== 'done' && <div className="text-[13px] text-mute leading-snug">{ru ? 'Почему ' : 'Why '}{m ? short(m) : ''}: {reasonText(t.assignReason, lang)}</div>}

      {t.status === 'unassigned' && (
        <>
          <div className="text-[13px] leading-snug" style={{ color: '#7A4510' }}>{ru ? 'Никто не может взять' : 'Nobody can take it'}{t.declinedBy.length ? ` · ${ru ? 'отказались' : 'declined'}: ${t.declinedBy.map(id => byId.get(id) ? short(byId.get(id)!) : id).join(', ')}` : ''}</div>
          <div className="flex flex-wrap gap-2">
            <form action={rescheduleAction}>{hidden('taskId', t.id)}<button className={btnPrimary} style={{ background: 'var(--dm-forest)' }}>{ru ? 'Перенести на завтра' : 'Move to tomorrow'}</button></form>
            <form action={cancelAction}>{hidden('taskId', t.id)}<button className={btnGhost} style={{ borderColor: '#C9D3CE' }}>{ru ? 'Отменить дело' : 'Cancel task'}</button></form>
          </div>
        </>
      )}
      {m && t.status === 'assigned' && (
        <div className="flex flex-wrap gap-2">
          <form action={respondAction}>{hidden('taskId', t.id)}{hidden('memberId', m.id)}<button name="answer" value="accept" className={btnPrimary} style={{ background: 'var(--dm-forest)' }}>{ru ? 'Ок, сделаю' : 'Ok, will do'}</button></form>
          <form action={respondAction}>{hidden('taskId', t.id)}{hidden('memberId', m.id)}<button name="answer" value="decline" className={btnGhost} style={{ borderColor: '#C9D3CE' }}>{ru ? 'Не могу' : "Can't"}</button></form>
          {!t.urgent && <form action={respondAction}>{hidden('taskId', t.id)}{hidden('memberId', m.id)}{hidden('proposeInMin', '120')}<button name="answer" value="decline" className={btnGhost} style={{ borderColor: '#C9D3CE' }}>{ru ? 'Через 2 часа' : 'In 2 hours'}</button></form>}
        </div>
      )}
      {m && t.status === 'accepted' && (
        <div className="flex flex-wrap gap-2">
          <form action={doneAction}>{hidden('taskId', t.id)}{hidden('memberId', m.id)}<button className={btnPrimary} style={{ background: 'var(--dm-forest)' }}>{ru ? 'Готово' : 'Done'}</button></form>
          {t.needsProof && <form action={doneAction}>{hidden('taskId', t.id)}{hidden('memberId', m.id)}{hidden('photo', '1')}<button className={btnGhost} style={{ borderColor: '#C9D3CE' }}>{ru ? 'Готово + фото' : 'Done + photo'}</button></form>}
        </div>
      )}
    </li>
  );
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const lang = (await getLang()) as Lang;
  const ru = lang === 'ru';
  const view = (await searchParams).view === 'status' ? 'status' : 'people';
  const { store, member: me } = await panelContext();
  const [members, allTasks] = await Promise.all([store.members(), store.tasks()]);
  const tasks = allTasks.filter(t => !t.private || me?.isAdmin || t.authorId === me?.id || t.assigneeId === me?.id);
  const byId = new Map(members.map(m => [m.id, m]));
  const nowMs = Date.now();
  const sinceMs = nowMs - 7 * 86_400_000;

  const orphans = tasks.filter(t => t.status === 'new' || t.status === 'unassigned').sort((a, b) => dueMs(a) - dueMs(b));
  const people = members.map(m => {
    const open = tasks.filter(t => t.assigneeId === m.id && (t.status === 'assigned' || t.status === 'accepted')).sort((a, b) => dueMs(a) - dueMs(b));
    const done = tasks.filter(t => t.assigneeId === m.id && t.status === 'done' && Date.parse(t.doneAt ?? t.createdAt) >= sinceMs);
    return { m, open, done };
  });
  const openTotal = people.reduce((s, p) => s + p.open.length, 0) + orphans.length;
  const doneTotal = people.reduce((s, p) => s + p.done.length, 0);

  const tab = (v: 'people' | 'status', label: string) => (
    <Link href={v === 'people' ? '/domovoy/tasks' : '/domovoy/tasks?view=status'} aria-current={view === v ? 'page' : undefined}
      className="min-h-[40px] px-4 rounded-xl flex items-center text-[14px] font-semibold"
      style={view === v ? { background: 'var(--dm-forest)', color: '#FFFFFF' } : { color: 'var(--color-ink)' }}>{label}</Link>
  );

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="m-0 text-[26px] md:text-[34px] leading-[1.15]">{ru ? 'Дела семьи' : 'Family tasks'}</h1>
          <p className="m-0 text-[15px] text-mute max-w-[62ch]">{ru ? `${openTotal} в работе · ${doneTotal} сделано за неделю. Кнопки — это ответы людей из Telegram, здесь их можно нажать за них.` : `${openTotal} open · ${doneTotal} done this week. The buttons are people’s Telegram replies — press them on their behalf.`}</p>
        </div>
        <nav aria-label={ru ? 'Вид' : 'View'} className="flex gap-1 p-1 rounded-2xl bg-white">
          {tab('people', ru ? 'По людям' : 'By person')}
          {tab('status', ru ? 'По статусам' : 'By status')}
        </nav>
      </header>

      {view === 'people' ? (
        <>
          {orphans.length > 0 && (
            <section aria-labelledby="orph-h" className="rounded-[24px] md:rounded-[28px] p-5 md:p-6 flex flex-col gap-3" style={{ background: '#FFF4E6', border: '2px dashed var(--dm-pulse)' }}>
              <h2 id="orph-h" className="m-0 text-[18px] font-bold">{ru ? `Ждут исполнителя · ${orphans.length}` : `Needs someone · ${orphans.length}`}</h2>
              <p className="m-0 text-[14px] text-mute">{ru ? 'Агент не нашёл, кому поручить: все отказались или заняты. Решите, что с ними делать.' : 'The agent found nobody: everyone declined or is busy. Decide what to do.'}</p>
              <ul className="list-none m-0 p-0 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
                {orphans.map(t => <TaskCard key={t.id} t={t} byId={byId} lang={lang} nowMs={nowMs} />)}
              </ul>
            </section>
          )}

          <div className="grid gap-5 md:gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 340px), 1fr))' }}>
            {people.map(({ m, open, done }) => {
              const col = memberColor(m.id);
              return (
                <section key={m.id} aria-label={m.name} className="bg-white rounded-[24px] md:rounded-[28px] overflow-hidden flex flex-col min-w-0">
                  <div className="h-1.5" style={{ background: col }} />
                  <div className="p-5 md:p-6 flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <span aria-hidden="true" className="w-12 h-12 rounded-full text-white text-[20px] font-bold flex items-center justify-center shrink-0" style={{ background: col }}>{initial(m)}</span>
                      <div className="min-w-0 flex-1">
                        <h2 className="m-0 text-[18px] font-bold truncate">{m.name}</h2>
                        <span className="text-[13px] text-mute">{open.length ? (ru ? `${open.length} в работе` : `${open.length} open`) : (ru ? 'свободен(на)' : 'free')} · {ru ? `${done.length} сделано за неделю` : `${done.length} done this week`}</span>
                      </div>
                    </div>
                    {open.length > 0 ? (
                      <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
                        {open.map(t => <TaskCard key={t.id} t={t} m={m} byId={byId} lang={lang} nowMs={nowMs} />)}
                      </ul>
                    ) : (
                      <p className="m-0 text-[14px] text-mute rounded-2xl px-4 py-3" style={{ background: 'var(--dm-air)' }}>{ru ? 'Сейчас дел нет — агент учтёт это при следующем распределении.' : 'Nothing open — the agent will take that into account next time.'}</p>
                    )}
                    {done.length > 0 && (
                      <details className="text-[14px]">
                        <summary className="cursor-pointer min-h-[36px] flex items-center text-mute font-semibold">{ru ? `Сделано за неделю · ${done.length}` : `Done this week · ${done.length}`}</summary>
                        <ul className="list-none m-0 mt-2 p-0 flex flex-col gap-1.5">
                          {done.sort((a, b) => Date.parse(b.doneAt ?? b.createdAt) - Date.parse(a.doneAt ?? a.createdAt)).map(t => (
                            <li key={t.id} className="flex items-center gap-2 text-mute">
                              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2.5" strokeLinecap="round"><path d="M5 12l4 4 10-10" /></svg>
                              <span className="truncate">{t.text}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <div className="grid gap-4 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))' }}>
          {STATUS_COLS.map(c => {
            const items = tasks.filter(t => c.statuses.includes(t.status)).sort((a, b) => dueMs(b) - dueMs(a));
            return (
              <section key={c.key} className="bg-white rounded-[24px] p-4 flex flex-col gap-3 min-w-0">
                <h2 className="m-0 px-1 text-[16px] font-bold">{ru ? c.ru : c.en} · {items.length}</h2>
                {items.length === 0 && <p className="m-0 px-1 py-4 text-[14px] text-mute">{ru ? 'Пусто' : 'Empty'}</p>}
                <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
                  {items.slice(0, 12).map(t => <TaskCard key={t.id} t={t} m={t.assigneeId ? byId.get(t.assigneeId) : undefined} byId={byId} lang={lang} nowMs={nowMs} showWho />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {(me?.isAdmin ?? true) && (
        <form action={tickAction} className="flex flex-wrap items-center gap-2 text-[13px] text-mute">
          <span>{ru ? 'Демо: промотать время, чтобы увидеть напоминания и передачи —' : 'Demo: skip time to see reminders and hand-overs —'}</span>
          {[20, 60, 120].map(v => <button key={v} name="plusMin" value={v} className="min-h-[36px] px-3 rounded-lg border bg-white font-semibold text-ink" style={{ borderColor: '#C9D3CE' }}>+{v} {ru ? 'мин' : 'min'}</button>)}
        </form>
      )}
    </div>
  );
}
