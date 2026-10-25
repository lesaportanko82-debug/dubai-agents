import Link from 'next/link';
import { domovoyState } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Pill } from '@/components/ui';
import { Avatar, memberColor } from '@/components/domovoy/Member';
import { hhmm } from '@core/domovoy/household';
import { reasonText } from '@/lib/reasons';

export const dynamic = 'force-dynamic';

export default async function DomovoyHome() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store, runs } = domovoyState();
  const [members, tasks, events] = await Promise.all([store.members(), store.tasks(), store.events()]);
  const today = new Date().toISOString().slice(0, 10);
  const todays = tasks.filter(t => (t.dueAt ?? t.createdAt).slice(0, 10) === today).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  const open = todays.filter(t => ['assigned', 'accepted', 'new', 'unassigned'].includes(t.status));
  const doneToday = todays.filter(t => t.status === 'done');

  // the metric that matters: tasks closed without the author stepping in
  const weekDone = tasks.filter(t => t.status === 'done');
  const withoutAuthor = weekDone.filter(t => t.assigneeId !== t.authorId).length;
  const share = weekDone.length ? Math.round((100 * withoutAuthor) / weekDone.length) : 0;
  const remindersByAgent = events.filter(e => e.type === 'reminded').length + tasks.filter(t => t.reminderLevel > 0).length;

  // day strip: 7:00–22:00 Dubai
  const H0 = 7, H1 = 22;
  const pos = (iso: string) => {
    const [h, m] = hhmm(iso).split(':').map(Number);
    return Math.max(0, Math.min(100, ((h + m / 60 - H0) / (H1 - H0)) * 100));
  };
  const byMember = members.map(m => ({ m, items: todays.filter(t => t.assigneeId === m.id) })).filter(x => x.items.length);

  return (
    <>
      <PageTitle
        title={ru ? 'Сегодня в доме' : 'Today at home'}
        lead={ru ? 'Кто что делает и когда. Напоминает Домовёнок, а не мама.' : 'Who is doing what, and when. Domovoy does the reminding, not mum.'}
        right={
          <Link href="/domovoy/try" className="rounded-md accent-bg text-white px-4 py-2 text-[14px] font-medium">{ru ? 'Сказать Домовёнку' : 'Tell Domovoy'}</Link>
        }
      />

      <Panel className="mb-5">
        <div className="px-5 pt-5 pb-3 flex flex-wrap gap-x-10 gap-y-2 items-baseline">
          <div>
            <div className="text-[13px] text-mute">{ru ? 'Дел закрыто без участия автора' : 'Tasks closed without the author stepping in'}</div>
            <div className="text-[34px] font-semibold accent-text num">{share}%</div>
          </div>
          <div>
            <div className="text-[13px] text-mute">{ru ? 'Напоминаний отправила мама' : 'Reminders sent by mum'}</div>
            <div className="text-[22px] font-semibold num">0</div>
          </div>
          <div>
            <div className="text-[13px] text-mute">{ru ? 'Напомнил Домовёнок' : 'Reminders by Domovoy'}</div>
            <div className="text-[22px] font-semibold num">{remindersByAgent}</div>
          </div>
          <div className="ml-auto text-[13px] text-mute">{ru ? `Сегодня: ${open.length} в работе · ${doneToday.length} сделано` : `Today: ${open.length} open · ${doneToday.length} done`}</div>
        </div>

        {/* day strip */}
        <div className="px-5 pb-5">
          <div className="relative ml-[120px] h-5 text-[11px] text-mute">
            {Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i).filter(h => h % 3 === 1 || h === H0).map(h => (
              <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - H0) / (H1 - H0)) * 100}%` }}>{h}:00</span>
            ))}
          </div>
          {byMember.length === 0 && <div className="text-mute text-[14px] py-6 text-center">{ru ? 'На сегодня дел нет. Скажите Домовёнку, что нужно сделать.' : 'Nothing planned today. Tell Domovoy what needs doing.'}</div>}
          {byMember.map(({ m, items }) => (
            <div key={m.id} className="flex items-center gap-3 py-1.5">
              <div className="w-[108px] flex items-center gap-2 shrink-0">
                <Avatar m={m} size={28} />
                <span className="text-[13px] font-medium truncate">{m.name.replace('Бабушка ', '')}</span>
              </div>
              <div className="relative flex-1 h-9 rounded bg-stone-50 border border-stone-200">
                {items.map(t => t.dueAt && (
                  <div
                    key={t.id}
                    title={`${t.text} · ${hhmm(t.dueAt)} · ${t.minutes} ${ru ? 'мин' : 'min'}`}
                    className="absolute top-1 bottom-1 rounded px-2 text-[12px] text-white truncate flex items-center"
                    style={{ left: `calc(${pos(t.dueAt)}% - 4px)`, width: `max(72px, ${(t.minutes / 60 / (H1 - H0)) * 100}%)`, background: memberColor(m.id), opacity: t.status === 'done' ? 0.45 : 1, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}
                  >
                    {t.text}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-5">
        <Panel title={ru ? 'Последнее решение Домовёнка' : 'Domovoy’s latest decision'}>
          <div className="px-5 pb-5 text-[14px]">
            {runs[0] ? (
              <>
                <div className="text-mute text-[13px] mb-1">{runs[0].at.slice(11, 16)} · {members.find(m => m.id === runs[0].authorId)?.name}: «{runs[0].input.slice(0, 90)}»</div>
                <p className="whitespace-pre-wrap">{runs[0].result.summary}</p>
                <Link href="/domovoy/trace" className="inline-block mt-3 underline underline-offset-2 text-ink-soft">{ru ? 'Как он решал' : 'How it decided'}</Link>
              </>
            ) : (
              <ul className="space-y-2">
                {open.slice(0, 4).map(t => {
                  const m = members.find(x => x.id === t.assigneeId);
                  return (
                    <li key={t.id} className="flex gap-2 items-start">
                      {m && <Avatar m={m} size={22} />}
                      <span><b>{t.text}</b> → {m?.name ?? '—'}{t.assignReason ? <span className="text-mute"> · {reasonText(t.assignReason, lang)}</span> : ''}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>
        <Panel title={ru ? 'Как это работает' : 'How it works'}>
          <ol className="px-5 pb-5 text-[14px] space-y-2">
            {[
              ru ? 'Любой член семьи пишет или говорит Домовёнку, что нужно сделать' : 'Anyone in the family tells Domovoy what needs doing',
              ru ? 'Агент разбирает сообщение на дела и смотрит, кто свободен, умеет и чья очередь' : 'The agent splits it into tasks and checks who is free, able and due by fairness',
              ru ? 'Каждому приходит личное сообщение на его языке: папе коротко, помощнице на тагальском, ребёнку квест' : 'Everyone gets a personal message in their language: dad short, helper in Tagalog, child a quest',
              ru ? 'Напоминает Домовёнок по лестнице: мягко → с юмором → на доску. Автор дела в цепочке не участвует' : 'Domovoy reminds in steps: gentle → humorous → family board. The author is never in the chain',
            ].map((s, i) => <li key={i} className="flex gap-3"><Pill tone="accent">{i + 1}</Pill><span>{s}</span></li>)}
          </ol>
        </Panel>
      </div>
    </>
  );
}
