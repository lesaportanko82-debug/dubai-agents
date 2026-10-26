import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { memberColor } from '@/components/domovoy/Member';
import { APPROVAL_POLICY } from '@core/domovoy/approvals';
import { decideAction } from '../loop-actions';
import type { Approval, ApprovalAction, Member } from '@core/domovoy/types';

export const dynamic = 'force-dynamic';

const STATUS: Record<Approval['status'], { ru: string; en: string; bg: string; fg: string }> = {
  pending: { ru: 'ждёт', en: 'pending', bg: '#FFF1DD', fg: '#7A4510' },
  approved: { ru: 'одобрено', en: 'approved', bg: '#E4F0E3', fg: '#2C5A2B' },
  executed: { ru: 'выполнено', en: 'done', bg: '#E4F0E3', fg: '#2C5A2B' },
  rejected: { ru: 'отклонено', en: 'rejected', bg: '#F7E4EB', fg: '#7A2A47' },
  expired: { ru: 'истекло', en: 'expired', bg: '#EEF1EE', fg: '#33443D' },
  failed: { ru: 'ошибка', en: 'failed', bg: '#F7E4EB', fg: '#7A2A47' },
};

const ICON: Record<ApprovalAction, React.ReactNode> = {
  reschedule_task: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  create_task: <path d="M12 5v14M5 12h14" />,
  cancel_task: <path d="M6 6l12 12M18 6L6 18" />,
  spend_money: <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18" /></>,
  change_child_schedule: <><circle cx="12" cy="7" r="3" /><path d="M6 21c0-4 3-6 6-6s6 2 6 6" /></>,
  share_outside: <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />,
};

const WHO: Record<string, { ru: string; en: string }> = {
  admins: { ru: 'родители (админы)', en: 'parents (admins)' },
  author: { ru: 'автор дела', en: 'the task’s author' },
  author_or_admins: { ru: 'автор или родители', en: 'author or parents' },
};

function left(ms: number, ru: boolean) {
  if (ms <= 0) return ru ? 'время вышло' : 'time is up';
  const m = Math.round(ms / 60_000), h = Math.floor(m / 60), mm = m % 60;
  return ru ? `ещё ${h ? `${h} ч ` : ''}${mm} мин` : `${h ? `${h} h ` : ''}${mm} min left`;
}
const ttl = (min: number, ru: boolean) => (min >= 60 ? `${min / 60} ${ru ? 'ч' : 'h'}` : `${min} ${ru ? 'мин' : 'min'}`);

export default async function ApprovalsPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const ctx = await panelContext();
  const { store } = ctx;
  const members = await store.members();
  const me = ctx.member ?? members.find(m => m.isAdmin) ?? members[0];
  const all = await store.approvals({ limit: 60 });
  const nowMs = Date.now();
  const mine = all.filter(a => a.status === 'pending' && Date.parse(a.expiresAt) > nowMs && a.approverIds.includes(me.id));
  const othersPending = all.filter(a => a.status === 'pending' && Date.parse(a.expiresAt) > nowMs && !a.approverIds.includes(me.id));
  const history = all.filter(a => !mine.includes(a) && !othersPending.includes(a));
  const byId = new Map(members.map(m => [m.id, m]));
  const name = (id: string) => byId.get(id)?.name ?? (id === 'agent' ? (ru ? 'агент' : 'the agent') : id);
  const when = (iso: string) => new Date(iso).toLocaleString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: ctx.household?.tz ?? 'Asia/Dubai' });
  const Dot = ({ m }: { m: Member }) => <span aria-hidden="true" className="w-6 h-6 rounded-full text-white text-[11px] font-bold inline-flex items-center justify-center shrink-0" style={{ background: memberColor(m.id) }}>{m.name.replace(/^(Бабушка|Дедушка)\s+/, '').slice(0, 1)}</span>;
  const stats = { yes: all.filter(a => a.status === 'approved' || a.status === 'executed').length, no: all.filter(a => a.status === 'rejected').length };

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[26px] md:text-[34px] leading-[1.15]">{ru ? 'Решения' : 'Decisions'}</h1>
        <p className="m-0 text-[15px] text-mute max-w-[64ch]">{ru ? `Мелочи агент делает сам. Всё, что касается детей, денег и личных данных, он спрашивает у людей. Вы вошли как ${me.name}.` : `The agent handles small things itself. Anything about children, money or personal data it asks people first. You are ${me.name}.`}</p>
      </header>

      <section aria-labelledby="mine-h" className="flex flex-col gap-4">
        <h2 id="mine-h" className="m-0 text-[20px] font-bold">{ru ? `Ждут вашего ответа · ${mine.length}` : `Waiting for you · ${mine.length}`}</h2>
        {mine.length === 0 ? (
          <div className="rounded-[24px] md:rounded-[28px] p-6 flex items-center gap-4 bg-white">
            <span aria-hidden="true" className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-wash)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1F3B33" strokeWidth="2" strokeLinecap="round"><path d="M5 12l4 4 10-10" /></svg>
            </span>
            <p className="m-0 text-[15px] leading-relaxed">{ru ? 'Сейчас ничего не ждёт. Когда понадобится ваше решение, агент напишет в Telegram и покажет его здесь.' : 'Nothing is waiting. When your decision is needed, the agent messages you in Telegram and shows it here.'}</p>
          </div>
        ) : (
          <div className="grid gap-4 md:gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))' }}>
            {mine.map(a => (
              <article key={a.id} className="rounded-[24px] md:rounded-[28px] p-6 flex flex-col gap-4 text-white" style={{ background: 'var(--dm-forest)' }}>
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--dm-forest-2)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F2B66D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[a.action]}</svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold first-letter:uppercase">{ru ? APPROVAL_POLICY[a.action].label.ru : APPROVAL_POLICY[a.action].label.en}</div>
                    <div className="text-[13px]" style={{ color: 'var(--dm-forest-mute)' }}>{ru ? 'просит' : 'asked by'} {name(a.requestedBy)}</div>
                  </div>
                  <span className="text-[13px] font-semibold rounded-lg px-2.5 py-1 whitespace-nowrap" style={{ background: 'var(--dm-forest-2)', color: 'var(--dm-hearth)' }}>{left(Date.parse(a.expiresAt) - nowMs, ru)}</span>
                </div>
                <p className="m-0 text-[16px] leading-relaxed whitespace-pre-line">{ru ? a.reason.ru : a.reason.en}</p>
                {a.fallback && (
                  <div className="text-[14px] rounded-xl px-4 py-3" style={{ background: 'var(--dm-forest-2)', color: 'var(--dm-forest-text)' }}>
                    {ru ? 'Если «нет»: ' : 'If "no": '}{ru ? a.fallback.ru : a.fallback.en}
                  </div>
                )}
                <form action={decideAction} className="flex gap-2.5 flex-wrap mt-auto">
                  <input type="hidden" name="approvalId" value={a.id} />
                  <button name="decision" value="approve" className="flex-[1_1_140px] min-h-[52px] rounded-[14px] font-bold text-[16px]" style={{ background: 'var(--dm-hearth)', color: 'var(--dm-forest)' }}>{ru ? 'Да, делай' : 'Yes, do it'}</button>
                  <button name="decision" value="reject" className="flex-[1_1_140px] min-h-[52px] rounded-[14px] font-semibold text-[16px] border" style={{ borderColor: '#5E8378' }}>{ru ? 'Нет, оставь' : 'No, leave it'}</button>
                </form>
                <div className="text-[12px]" style={{ color: 'var(--dm-forest-mute)' }}>{ru ? 'Решают' : 'Deciders'}: {a.approverIds.map(name).join(', ')} · {ru ? 'ответит первый — решение для всех' : 'the first answer counts for everyone'}</div>
              </article>
            ))}
          </div>
        )}
        {othersPending.length > 0 && (
          <p className="m-0 text-[14px] text-mute">{ru ? `Ещё ${othersPending.length} ждут ответа других членов семьи.` : `${othersPending.length} more wait for other family members.`}</p>
        )}
      </section>

      <div className="flex flex-wrap gap-5 md:gap-6 items-start">
        <section aria-labelledby="rules-h" className="flex-[2_1_340px] min-w-0 bg-white rounded-[24px] md:rounded-[28px] p-5 md:p-7 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="rules-h" className="m-0 text-[20px] font-bold">{ru ? 'Правила доверия' : 'Trust rules'}</h2>
            <p className="m-0 text-[14px] text-mute">{ru ? 'Кто решает и сколько агент ждёт ответа. Нет ответа — ничего не меняется.' : 'Who decides and how long the agent waits. No answer — nothing changes.'}</p>
          </div>
          <ul className="list-none m-0 p-0 flex flex-col">
            {(Object.keys(APPROVAL_POLICY) as ApprovalAction[]).map((k, i, arr) => (
              <li key={k} className="flex items-center gap-3 min-h-[52px] py-2" style={{ borderBottom: i < arr.length - 1 ? '1px solid var(--dm-line)' : 'none' }}>
                <span aria-hidden="true" className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-wash)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F3B33" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[k]}</svg>
                </span>
                <span className="flex-1 min-w-0 text-[15px] first-letter:uppercase">{ru ? APPROVAL_POLICY[k].label.ru : APPROVAL_POLICY[k].label.en}</span>
                <span className="text-[13px] text-mute text-right">{ru ? WHO[APPROVAL_POLICY[k].who].ru : WHO[APPROVAL_POLICY[k].who].en}<br />{ttl(APPROVAL_POLICY[k].ttlMin, ru)}</span>
              </li>
            ))}
            <li className="flex items-center gap-3 min-h-[52px] pt-3">
              <span aria-hidden="true" className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#FFF1DD' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9A5414" strokeWidth="2" strokeLinecap="round"><path d="M5 12l4 4 10-10" /></svg>
              </span>
              <span className="flex-1 min-w-0 text-[15px]">{ru ? 'Бытовые мелочи (бельё, окна)' : 'Small chores (laundry, windows)'}</span>
              <span className="text-[13px] text-mute text-right">{ru ? 'агент сам,' : 'the agent,'}<br />{ru ? 'с кнопкой «отменить»' : 'with an undo button'}</span>
            </li>
          </ul>
          <p className="m-0 text-[13px] text-mute">{ru ? 'Ребёнок или помощница никогда не одобряют сами — вопрос уходит взрослым.' : 'A child or the helper never approves alone — the question goes to the adults.'}</p>
        </section>

        <section aria-labelledby="hist-h" className="flex-[3_1_420px] min-w-0 bg-white rounded-[24px] md:rounded-[28px] p-5 md:p-7 flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="hist-h" className="m-0 text-[20px] font-bold">{ru ? 'История решений' : 'Decision history'}</h2>
            <span className="text-[14px] text-mute">{ru ? `одобрено ${stats.yes} · отклонено ${stats.no}` : `${stats.yes} approved · ${stats.no} rejected`}</span>
          </div>
          {history.length === 0 ? <p className="m-0 text-[15px] text-mute">{ru ? 'Пока решений не было.' : 'No decisions yet.'}</p> : (
            <ol className="list-none m-0 p-0 flex flex-col">
              {history.map((a, i) => {
                const s = STATUS[a.status];
                const decider = a.decidedBy ? byId.get(a.decidedBy) : undefined;
                return (
                  <li key={a.id} className="flex items-start gap-3 py-3.5" style={{ borderBottom: i < history.length - 1 ? '1px solid var(--dm-line)' : 'none' }}>
                    <span aria-hidden="true" className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: s.bg }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={s.fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICON[a.action]}</svg>
                    </span>
                    <div className="min-w-0 flex-1 flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-semibold rounded-lg px-2 py-0.5" style={{ background: s.bg, color: s.fg }}>{ru ? s.ru : s.en}</span>
                        <span className="text-[13px] text-mute">{ru ? APPROVAL_POLICY[a.action].label.ru : APPROVAL_POLICY[a.action].label.en} · {when(a.createdAt)}</span>
                      </div>
                      <span className="text-[15px] leading-snug">{(ru ? a.reason.ru : a.reason.en).split('\n')[0]}</span>
                      <span className="text-[13px] text-mute flex items-center gap-1.5 flex-wrap">
                        {ru ? 'просил(а)' : 'asked by'} {name(a.requestedBy)}
                        {decider && <> · {ru ? 'решил(а)' : 'decided by'} <Dot m={decider} /> {decider.name}</>}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
