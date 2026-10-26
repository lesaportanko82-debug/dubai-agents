import Link from 'next/link';
import { redirect } from 'next/navigation';
import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { memberColor } from '@/components/domovoy/Member';
import { hhmm } from '@core/domovoy/household';
import { impactMetrics } from '@core/domovoy/metrics';
import type { Member, Task, TaskEvent } from '@core/domovoy/types';
import { demoAction, resetDemoAction, decideAction } from './loop-actions';

export const dynamic = 'force-dynamic';

const OPEN = ['new', 'unassigned', 'assigned', 'accepted'];
const initial = (m: Member) => m.name.replace(/^(Бабушка|Дедушка)\s+/, '').slice(0, 1).toUpperCase();
const short = (m: Member) => m.name.replace(/^(Бабушка|Дедушка)\s+/, '');

/** Ring geometry: members evenly spaced on a circle around the home. */
function ringPositions(n: number, box = 360, r = 140, size = 64) {
  return Array.from({ length: n }, (_, i) => {
    const a = (-90 + (360 / Math.max(n, 1)) * i) * (Math.PI / 180);
    return { left: Math.round(box / 2 + r * Math.cos(a) - size / 2), top: Math.round(box / 2 + r * Math.sin(a) - size / 2) };
  });
}

function agentLine(e: TaskEvent, task: Task | undefined, ru: boolean): { title: string; tone: 'hearth' | 'forest' | 'blue' } | undefined {
  const q = task ? (ru ? `«${task.text}»` : `"${task.text}"`) : '';
  switch (e.type) {
    case 'autonomous_action': return { title: ru ? `Сделал сам: ${q}` : `Did it myself: ${q}`, tone: 'hearth' };
    case 'loop_closed': return { title: ru ? `Цикл закрыт: ${q}` : `Loop closed: ${q}`, tone: 'blue' };
    case 'swapped': case 'auto_replaced': return { title: ru ? `Передал другому: ${q}` : `Handed over: ${q}`, tone: 'forest' };
    case 'rescheduled': return { title: ru ? `Перенёс: ${q}` : `Rescheduled: ${q}`, tone: 'forest' };
    case 'reminded': return { title: ru ? `Напомнил вместо вас: ${q}` : `Reminded for you: ${q}`, tone: 'forest' };
    default: return undefined;
  }
}

export default async function DomovoyHome() {
  const ctx = await panelContext();
  if (!ctx.authenticated) redirect('/login/domovoy');

  const lang = await getLang();
  const ru = lang === 'ru';
  const { store, household, member } = ctx;
  const nowIso = new Date().toISOString();
  const [members, tasks, events, pending, m] = await Promise.all([
    store.members(), store.tasks(), store.events(), store.approvals({ status: 'pending' }), impactMetrics(store, nowIso, 7),
  ]);

  const today = nowIso.slice(0, 10);
  const todays = tasks.filter(t => (t.dueAt ?? t.createdAt).slice(0, 10) === today);
  const openToday = todays.filter(t => OPEN.includes(t.status));
  const overdue = openToday.filter(t => t.dueAt && t.dueAt < nowIso);
  const inOrder = todays.length ? Math.round((100 * (todays.length - overdue.length)) / todays.length) : 100;
  const busiest = members.map(x => ({ x, n: tasks.filter(t => t.assigneeId === x.id && t.status === 'done').length })).sort((a, b) => b.n - a.n)[0];
  const totalDone = tasks.filter(t => t.status === 'done').length;
  const topShare = totalDone && busiest ? Math.round((100 * busiest.n) / totalDone) : 0;

  const pos = ringPositions(Math.min(members.length, 8));
  const ring = members.slice(0, 8);
  const R = 74, C = 2 * Math.PI * R;

  const first = pending[0];
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const feed = events
    .filter(e => e.actor === 'agent')
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(e => ({ e, line: agentLine(e, taskById.get(e.taskId), ru) }))
    .filter(x => x.line)
    .slice(0, 4);

  // day lanes 07:00–22:00
  const H0 = 7, H1 = 22;
  const pct = (iso: string) => { const [h, mi] = hhmm(iso).split(':').map(Number); return Math.max(0, Math.min(94, ((h + mi / 60 - H0) / (H1 - H0)) * 100)); };
  const lanes = members.map(x => ({ x, items: todays.filter(t => t.assigneeId === x.id && t.dueAt) })).filter(l => l.items.length);

  const greet = (() => { const h = Number(hhmm(nowIso).slice(0, 2)); return h < 12 ? (ru ? 'Доброе утро' : 'Good morning') : h < 18 ? (ru ? 'Добрый день' : 'Good afternoon') : (ru ? 'Добрый вечер' : 'Good evening'); })();
  const dateLabel = new Date(nowIso).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: household?.tz ?? 'Asia/Dubai' });

  const card = 'bg-white rounded-[24px] md:rounded-[28px] p-5 md:p-7 min-w-0';

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-[14px] text-mute first-letter:uppercase">{dateLabel}</span>
          <h1 className="m-0 text-[26px] md:text-[34px] leading-[1.15] text-balance">
            {greet}{member ? `, ${member.name}` : ''}. {overdue.length ? (ru ? `${overdue.length} дел ждут внимания.` : `${overdue.length} tasks need attention.`) : (ru ? 'Дома всё под контролем.' : 'Everything at home is on track.')}
          </h1>
        </div>
        <Link href="/domovoy/try" className="inline-flex items-center gap-2.5 min-h-[48px] px-5 rounded-[14px] text-white font-semibold text-[15px]" style={{ background: 'var(--dm-forest)' }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          {ru ? 'Попросить агента' : 'Ask the agent'}
        </Link>
      </header>

      <div className="flex flex-wrap gap-5 md:gap-6 items-stretch">
        {/* Family circle */}
        <section aria-labelledby="circle-h" className={`${card} flex-[3_1_460px] flex flex-col gap-5`}>
          <div className="flex flex-wrap justify-between items-baseline gap-2">
            <h2 id="circle-h" className="m-0 text-[20px] font-bold">{ru ? 'Семейный круг' : 'Family circle'}</h2>
            <span className="text-[14px] text-mute">{ru ? 'кто чем занят сегодня' : 'who is doing what today'}</span>
          </div>
          <div className="flex flex-wrap gap-7 items-center justify-center">
            <div role="img" aria-label={ru ? `${members.length} человек вокруг дома, дел в порядке ${inOrder}%` : `${members.length} people around the home, ${inOrder}% on track`} className="relative w-[300px] h-[300px] sm:w-[360px] sm:h-[360px] shrink-0">
              <div className="absolute left-0 top-0 w-[360px] h-[360px] origin-top-left scale-[0.8333] sm:scale-100">
                <svg aria-hidden="true" width="360" height="360" viewBox="0 0 360 360" className="absolute left-0 top-0">
                  <circle cx="180" cy="180" r="140" fill="none" stroke="#D5DED9" strokeWidth="2" strokeDasharray="4 8" />
                  <circle cx="180" cy="180" r={R} fill="#FFF4E6" />
                  <circle cx="180" cy="180" r={R} fill="none" stroke="#EBDCC7" strokeWidth="10" />
                  <circle cx="180" cy="180" r={R} fill="none" stroke="var(--dm-pulse)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(C * inOrder) / 100} ${C}`} transform="rotate(-90 180 180)" />
                </svg>
                <div className="absolute left-[106px] top-[128px] w-[148px] flex flex-col items-center gap-0.5">
                  <span className="font-display text-[36px] font-bold num">{inOrder}%</span>
                  <span className="text-[13px] text-mute text-center leading-tight">{ru ? <>дел дома<br />в порядке</> : <>of home tasks<br />on track</>}</span>
                </div>
                {ring.map((x, i) => (
                  <span key={x.id} className="absolute w-16 h-16 rounded-full text-white text-[24px] font-bold flex items-center justify-center" style={{ left: pos[i].left, top: pos[i].top, background: memberColor(x.id), boxShadow: `0 0 0 4px #FFFFFF${x.id === member?.id ? `, 0 0 0 6px ${memberColor(x.id)}` : ''}` }}>
                    {initial(x)}
                  </span>
                ))}
              </div>
            </div>

            <ul className="list-none m-0 p-0 flex-[1_1_240px] min-w-0 flex flex-col gap-1">
              {members.map(x => {
                const mine = openToday.filter(t => t.assigneeId === x.id).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
                const what = mine.length ? mine.map(t => t.text).slice(0, 2).join(', ') : (ru ? 'свободен(на)' : 'free');
                return (
                  <li key={x.id} className="flex items-center gap-3 min-h-[44px]">
                    <span aria-hidden="true" className="w-3 h-3 rounded-full shrink-0" style={{ background: memberColor(x.id) }} />
                    <span className="flex-1 min-w-0 text-[15px] truncate"><b>{short(x)}</b> · {what}</span>
                    <span className="text-[13px] text-mute whitespace-nowrap">{mine.length} {ru ? (mine.length === 1 ? 'дело' : mine.length >= 2 && mine.length <= 4 ? 'дела' : 'дел') : 'open'}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          {totalDone > 0 && (
            <div className="flex items-center gap-3 rounded-2xl px-4 py-3.5" style={{ background: 'var(--accent-wash)' }}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1F3B33" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M4 12h16M12 4v16" /></svg>
              <span className="text-[14px] leading-snug">
                {topShare <= 35
                  ? (ru ? `Нагрузка распределена ровно: никто не сделал больше ${Math.max(topShare, 1)}% домашних дел.` : `Load is even: nobody did more than ${Math.max(topShare, 1)}% of the chores.`)
                  : (ru ? `${short(busiest.x)} сделал(а) ${topShare}% дел — агент будет чаще давать задания другим.` : `${short(busiest.x)} did ${topShare}% of the chores — the agent will lean on others more.`)}
              </span>
            </div>
          )}
        </section>

        {/* Decisions */}
        <section aria-labelledby="dec-h" className="flex-[2_1_320px] min-w-0 flex flex-col gap-4">
          <div className="rounded-[24px] md:rounded-[28px] p-6 flex flex-col gap-4 text-white" style={{ background: 'var(--dm-forest)' }}>
            <div className="flex items-center justify-between gap-2">
              <h2 id="dec-h" className="m-0 text-[18px] font-bold">{ru ? 'Нужно ваше решение' : 'Your decision needed'}</h2>
              {pending.length > 1 && <span className="text-[13px]" style={{ color: 'var(--dm-forest-mute)' }}>{ru ? `ещё ${pending.length - 1}` : `${pending.length - 1} more`}</span>}
            </div>
            {first ? (
              <>
                <p className="m-0 text-[16px] leading-relaxed whitespace-pre-line">{(ru ? first.reason.ru : first.reason.en).split('\n').slice(0, 3).join('\n')}</p>
                <form action={decideAction} className="flex gap-2.5 flex-wrap">
                  <input type="hidden" name="approvalId" value={first.id} />
                  <button name="decision" value="approve" className="flex-[1_1_120px] min-h-[48px] rounded-[14px] font-bold text-[15px]" style={{ background: 'var(--dm-hearth)', color: 'var(--dm-forest)' }}>{ru ? 'Да, делай' : 'Yes, do it'}</button>
                  <button name="decision" value="reject" className="flex-[1_1_120px] min-h-[48px] rounded-[14px] font-semibold text-[15px] border" style={{ borderColor: '#5E8378' }}>{ru ? 'Нет, оставь' : 'No, leave it'}</button>
                </form>
                {first.fallback && <span className="text-[13px]" style={{ color: 'var(--dm-forest-mute)' }}>{ru ? `Если «нет» — ${first.fallback.ru}` : `If "no" — ${first.fallback.en}`}</span>}
                <Link href="/domovoy/approvals" className="text-[13px] underline underline-offset-2" style={{ color: 'var(--dm-forest-mute)' }}>{ru ? 'Все решения' : 'All decisions'}</Link>
              </>
            ) : (
              <p className="m-0 text-[15px] leading-relaxed" style={{ color: 'var(--dm-forest-text)' }}>{ru ? 'Сейчас ничего не ждёт вашего ответа. Когда дело коснётся детей, денег или личных данных, агент спросит здесь и в Telegram.' : 'Nothing is waiting for you. When something touches children, money or personal data, the agent asks here and in Telegram.'}</p>
            )}
          </div>

          <div className="rounded-[24px] md:rounded-[28px] p-6 flex flex-col gap-4" style={{ background: 'var(--dm-hearth)', color: '#1F2A1F' }}>
            <h2 className="m-0 text-[18px] font-bold">{ru ? 'Вместе за неделю' : 'Together this week'}</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                [String(m.tasksDone), ru ? 'дел сделано' : 'tasks done'],
                [String(m.estimatedMinutesSaved), ru ? 'минут сэкономлено' : 'minutes saved'],
                [`${m.doneWithoutReminderPct}%`, ru ? 'без напоминаний' : 'without a reminder'],
                [String(m.conflictsPrevented + m.autonomousActions), ru ? 'раз агент помог сам' : 'times the agent stepped in'],
              ].map(([v, l]) => (
                <div key={l} className="flex flex-col"><span className="font-display text-[30px] font-bold num leading-none">{v}</span><span className="text-[13px] mt-1">{l}</span></div>
              ))}
            </div>
            <Link href="/domovoy/impact" className="text-[13px] underline underline-offset-2">{ru ? 'Как это посчитано' : 'How it is counted'}</Link>
          </div>
        </section>
      </div>

      {/* Day of the family */}
      <section aria-labelledby="day-h" className={`${card} flex flex-col gap-4`}>
        <div className="flex flex-wrap justify-between items-baseline gap-2">
          <h2 id="day-h" className="m-0 text-[20px] font-bold">{ru ? 'День семьи' : 'The family’s day'}</h2>
          <span className="text-[14px] text-mute">{ru ? 'каждая линия — один человек' : 'one line per person'}</span>
        </div>
        {lanes.length === 0 ? (
          <p className="m-0 text-mute text-[15px] py-4">{ru ? 'На сегодня дел со временем нет. Надиктуйте агенту в Telegram, что нужно сделать, — он распределит.' : 'Nothing timed for today. Tell the agent in Telegram what needs doing — it will dispatch it.'}</p>
        ) : (
          <>
          {/* phone: one list in time order */}
          <ul className="md:hidden list-none m-0 p-0 flex flex-col">
            {lanes.flatMap(({ x, items }) => items.map(t => ({ x, t }))).sort((a, b) => a.t.dueAt!.localeCompare(b.t.dueAt!)).map(({ x, t }, i, arr) => (
              <li key={t.id} className="flex items-center gap-3 min-h-[48px]" style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--dm-line)' : 'none' }}>
                <span className="w-11 shrink-0 text-[13px] text-mute num">{hhmm(t.dueAt!)}</span>
                <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: memberColor(x.id) }} />
                <span className="flex-1 min-w-0 text-[15px] truncate" style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none', color: t.status === 'done' ? 'var(--color-mute)' : undefined }}>{t.text} · {short(x)}</span>
                {t.dueAt! < nowIso && OPEN.includes(t.status) && <span className="text-[12px] font-semibold rounded-lg px-2 py-1 shrink-0" style={{ background: '#FFF1DD', color: '#7A4510' }}>{ru ? 'просрочено' : 'late'}</span>}
              </li>
            ))}
          </ul>
          {/* desktop: one lane per person */}
          <div className="hidden md:block overflow-x-auto">
            <div className="min-w-[720px] flex flex-col gap-2.5">
              <div className="relative ml-[120px] h-5 text-[12px] text-mute">
                {[7, 10, 13, 16, 19, 22].map(h => <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - H0) / (H1 - H0)) * 100}%` }}>{h}:00</span>)}
              </div>
              {lanes.map(({ x, items }) => (
                <div key={x.id} className="flex items-center gap-3 min-h-[44px]">
                  <span className="w-[108px] shrink-0 text-[14px] font-semibold truncate">{short(x)}</span>
                  <div className="relative flex-1 h-10">
                    <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: 'var(--dm-line)' }} />
                    {items.map(t => (
                      <span key={t.id} title={`${t.text} · ${hhmm(t.dueAt!)}`} className="absolute top-0 h-10 max-w-[180px] px-3 rounded-[10px] text-[13px] font-semibold flex items-center truncate"
                        style={{ left: `min(${pct(t.dueAt!)}%, calc(100% - 180px))`, background: `color-mix(in srgb, ${memberColor(x.id)} 14%, white)`, color: `color-mix(in srgb, ${memberColor(x.id)} 80%, black)`, textDecoration: t.status === 'done' ? 'line-through' : 'none', outline: t.dueAt! < nowIso && OPEN.includes(t.status) ? '2px dashed var(--dm-pulse)' : 'none', outlineOffset: -2 }}>
                        {hhmm(t.dueAt!)} · {t.text}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          </>
        )}
      </section>

      <div className="flex flex-wrap gap-5 md:gap-6">
        {/* What the agent did */}
        <section aria-labelledby="agent-h" className={`${card} flex-[3_1_420px] flex flex-col gap-2`}>
          <h2 id="agent-h" className="m-0 mb-2 text-[20px] font-bold">{ru ? 'Агент позаботился сам' : 'The agent took care of it'}</h2>
          {feed.length === 0 && <p className="m-0 text-mute text-[15px]">{ru ? 'Пока ничего. Агент будет показывать здесь всё, что сделал без вас: напоминания, передачи дел, реакции на погоду.' : 'Nothing yet. Everything the agent does on its own — reminders, hand-overs, weather moves — shows up here.'}</p>}
          {feed.map(({ e, line }, i) => (
            <div key={`${e.at}-${i}`} className="flex gap-3.5 items-start py-3" style={{ borderBottom: i < feed.length - 1 ? '1px solid var(--dm-line)' : 'none' }}>
              <span aria-hidden="true" className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center" style={{ background: line!.tone === 'hearth' ? '#FFF1DD' : line!.tone === 'blue' ? '#E3EEF4' : 'var(--accent-wash)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={line!.tone === 'hearth' ? '#9A5414' : line!.tone === 'blue' ? '#1D4A61' : '#1F3B33'} strokeWidth="2" strokeLinecap="round"><path d="M5 12l4 4 10-10" /></svg>
              </span>
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-[15px]">{line!.title}</span>
                <span className="text-[13px] text-mute">{hhmm(e.at)} · {e.at.slice(0, 10) === today ? (ru ? 'сегодня' : 'today') : e.at.slice(5, 10).split('-').reverse().join('.')}</span>
              </div>
            </div>
          ))}
          <Link href="/domovoy/trace" className="mt-2 text-[13px] underline underline-offset-2 text-mute">{ru ? 'Как думает агент' : 'How the agent thinks'}</Link>
        </section>

        {/* Show-me + demo controls */}
        {(member?.isAdmin ?? true) && (
          <section aria-labelledby="show-h" className={`${card} flex-[2_1_300px] flex flex-col gap-3`}>
            <h2 id="show-h" className="m-0 text-[20px] font-bold">{ru ? 'Посмотреть агента в деле' : 'See the agent at work'}</h2>
            <p className="m-0 text-[14px] text-mute leading-snug">{ru ? 'Запустите ситуацию — агент отреагирует сам, как в жизни.' : 'Trigger a situation — the agent reacts on its own, as in real life.'}</p>
            <form action={demoAction} className="flex flex-col gap-2">
              {([
                ['rain', ru ? 'Дождь во время футбола' : 'Rain during football'],
                ['pay', ru ? 'Покупка по правилам и выше лимита' : 'Purchase within and above the limit'],
                ['cart', ru ? 'Собрать корзину в магазине' : 'Build a shop cart'],
              ] as const).map(([k, l]) => (
                <button key={k} name="kind" value={k} className="min-h-[44px] px-4 rounded-xl text-left text-[14px] font-semibold border" style={{ borderColor: '#C9D3CE' }}>{l}</button>
              ))}
            </form>
            <div className="flex items-center justify-between gap-2 pt-1 text-[13px] text-mute">
              {ctx.isDemo && household ? <form action={resetDemoAction}><button className="underline underline-offset-2">{ru ? 'сбросить демо-семью' : 'reset the demo family'}</button></form> : <span />}
              <a href="/api/domovoy/logout" className="underline underline-offset-2 md:hidden">{ru ? 'выйти' : 'log out'}</a>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
