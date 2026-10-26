import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Pill, Empty } from '@/components/ui';
import { Avatar } from '@/components/domovoy/Member';
import { APPROVAL_POLICY } from '@core/domovoy/approvals';
import { decideAction } from '../loop-actions';
import type { Approval } from '@core/domovoy/types';

export const dynamic = 'force-dynamic';

const TONE: Record<Approval['status'], 'warn' | 'ok' | 'bad' | 'stone' | 'info'> = { pending: 'warn', approved: 'ok', executed: 'ok', rejected: 'bad', expired: 'stone', failed: 'bad' };
const STATUS: Record<Approval['status'], { ru: string; en: string }> = {
  pending: { ru: 'ждёт', en: 'pending' }, approved: { ru: 'одобрено', en: 'approved' }, executed: { ru: 'выполнено', en: 'done' },
  rejected: { ru: 'отклонено', en: 'rejected' }, expired: { ru: 'истекло', en: 'expired' }, failed: { ru: 'ошибка', en: 'failed' },
};

export default async function ApprovalsPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const ctx = await panelContext();
  const { store } = ctx;
  const members = await store.members();
  const me = ctx.member ?? members.find(m => m.isAdmin) ?? members[0];
  const all = await store.approvals({ limit: 60 });
  const now = new Date().toISOString();
  const mine = all.filter(a => a.status === 'pending' && a.expiresAt > now && a.approverIds.includes(me.id));
  const others = all.filter(a => !mine.includes(a));
  const name = (id: string) => members.find(m => m.id === id)?.name ?? (id === 'agent' ? (ru ? 'Домовёнок' : 'Domovoy') : id);
  const when = (iso: string) => iso.slice(5, 16).replace('T', ' ');

  return (
    <>
      <PageTitle
        title={ru ? 'Решения' : 'Decisions'}
        lead={ru ? `Человеческие чекпоинты: что агент не делает сам, а спрашивает. Вы вошли как ${me.name} — здесь то, что ждёт именно вас, и история всех решений семьи.` : `Human checkpoints: what the agent asks instead of doing. You are ${me.name} — below is what waits for you, and the family's decision history.`}
      />

      <Panel className="mb-5" title={ru ? `Ждут вашего решения · ${mine.length}` : `Waiting for you · ${mine.length}`}>
        {mine.length === 0 ? <Empty>{ru ? 'Ничего не ждёт. Агент спросит, когда дело коснётся денег, расписания ребёнка или данных вне семьи.' : 'Nothing pending. The agent will ask when money, a child\'s schedule or outside data is involved.'}</Empty> : (
          <ul className="px-5 pb-5 space-y-3">
            {mine.map(a => (
              <li key={a.id} className="rounded-card border border-amber-200 bg-amber-50/60 px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] uppercase tracking-wide text-mute">{ru ? APPROVAL_POLICY[a.action].label.ru : APPROVAL_POLICY[a.action].label.en} · {ru ? 'просит' : 'asked by'} {name(a.requestedBy)}</div>
                    <div className="text-[15px] mt-1 whitespace-pre-line">{ru ? a.reason.ru : a.reason.en}</div>
                    {a.fallback && <div className="text-[13px] text-mute mt-1">{ru ? 'Если «нет»: ' : 'If "no": '}{ru ? a.fallback.ru : a.fallback.en}</div>}
                    <div className="text-[12px] text-mute mt-1">{ru ? 'до' : 'until'} {when(a.expiresAt)}</div>
                  </div>
                  <form action={decideAction} className="flex gap-2 shrink-0">
                    <input type="hidden" name="approvalId" value={a.id} />
                    <button name="decision" value="approve" className="rounded-md accent-bg text-white px-3 py-1.5 text-[13px] font-medium">{ru ? 'да, делай' : 'yes, do it'}</button>
                    <button name="decision" value="reject" className="rounded-md border border-stone-300 bg-paper px-3 py-1.5 text-[13px]">{ru ? 'нет, оставь' : 'no, leave it'}</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={ru ? 'История' : 'History'}>
        {others.length === 0 ? <Empty>—</Empty> : (
          <ul className="px-5 pb-4 divide-y divide-stone-100 text-[14px]">
            {others.map(a => (
              <li key={a.id} className="py-2.5 flex items-start gap-3">
                <span className="num text-mute w-[84px] shrink-0 text-[12px] pt-0.5">{when(a.createdAt)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap"><Pill tone={TONE[a.status]}>{ru ? STATUS[a.status].ru : STATUS[a.status].en}</Pill><span className="text-[12px] text-mute">{ru ? APPROVAL_POLICY[a.action].label.ru : APPROVAL_POLICY[a.action].label.en}</span></div>
                  <div className="mt-0.5">{(ru ? a.reason.ru : a.reason.en).split('\n')[0]}</div>
                  <div className="text-[12px] text-mute mt-0.5">
                    {ru ? 'просил' : 'asked by'} {name(a.requestedBy)} · {ru ? 'решают' : 'deciders'} {a.approverIds.map(name).join(', ')}
                    {a.decidedBy && <> · {ru ? 'решил(а)' : 'decided by'} {name(a.decidedBy)} {a.decidedAt ? when(a.decidedAt) : ''}</>}
                  </div>
                </div>
                {a.decidedBy && members.find(m => m.id === a.decidedBy) && <Avatar m={members.find(m => m.id === a.decidedBy)!} size={22} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
