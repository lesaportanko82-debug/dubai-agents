import { getLang } from '@/lib/lang';
import { owedContext, ROLE_LABEL } from '@/lib/owed-server';
import { PageTitle, Panel, Empty } from '@/components/ui';
import type { Role } from '@core/owed/types';

export const dynamic = 'force-dynamic';

const ACTION: Record<string, { ru: string; en: string }> = {
  'case.saved': { ru: 'агент записал случай', en: 'agent recorded a case' },
  'case.merged': { ru: 'дубль объединён со случаем', en: 'duplicate merged into a case' },
  'case.confirm': { ru: 'случай подтверждён', en: 'case confirmed' },
  'case.reclassify': { ru: 'класс дефекта изменён', en: 'defect class changed' },
  'case.label': { ru: 'партия привязана по этикетке → A', en: 'batch set from the label → A' },
  'case.label_requested': { ru: 'запрошено фото этикетки', en: 'label photo requested' },
  'claim.drafted': { ru: 'собран черновик претензии', en: 'claim drafted' },
  'claim.reviewed': { ru: 'претензия проверена', en: 'claim reviewed' },
  'claim.sent': { ru: 'претензия отправлена', en: 'claim sent' },
  'claim.acknowledged': { ru: 'завод признал претензию', en: 'factory acknowledged' },
  'claim.disputed': { ru: 'завод оспорил претензию', en: 'factory disputed' },
  'claim.paid': { ru: 'компенсация получена', en: 'payment received' },
  'claim.legal': { ru: 'передано юристу', en: 'escalated to legal' },
  'claim.withdrawn': { ru: 'претензия отозвана', en: 'claim withdrawn' },
  'claim.letters': { ru: 'агент переписал письмо', en: 'agent rewrote the letter' },
  'claim.draft': { ru: 'возвращено в черновик', en: 'back to draft' },
  'contract.analysed': { ru: 'AI разобрал договор', en: 'AI analysed a contract' },
  'contract.clause_confirm': { ru: 'условие договора подтверждено', en: 'contract term confirmed' },
  'contract.clause_drop': { ru: 'условие договора отклонено', en: 'contract term dropped' },
  'settings.weights': { ru: 'изменены веса рейтинга', en: 'score weights changed' },
};

export default async function AuditPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store } = await owedContext();
  const log = await store.auditLog(300);
  const who = (a: string) => (a === 'agent' ? (ru ? 'агент' : 'agent') : ROLE_LABEL[a as Role]?.[lang] ?? a);
  return (
    <>
      <PageTitle title={ru ? 'Журнал' : 'Audit log'} lead={ru ? 'Каждое действие агента и людей: кто, что и когда. Решения по деньгам и договорам всегда принимает человек — здесь это видно.' : 'Every action by the agent and by people: who, what, when. Money and contract decisions are always made by a person — this is where you can see it.'} />
      <Panel>
        {log.length === 0 ? <Empty>—</Empty> : (
          <ul className="divide-y divide-stone-100 text-[14px]">
            {log.map((e, i) => (
              <li key={i} className="px-5 py-2.5 grid gap-1 md:grid-cols-[150px_140px_minmax(0,1fr)]">
                <span className="num text-mute text-[13px]">{e.at.slice(0, 16).replace('T', ' ')}</span>
                <span className={e.actor === 'agent' ? 'text-info' : 'font-medium'}>{who(e.actor)}</span>
                <span className="min-w-0">{ACTION[e.action]?.[lang] ?? e.action}{e.details ? <span className="text-mute text-[13px]"> · {Object.entries(e.details).filter(([k, v]) => v != null && typeof v !== 'object' && k !== 'raw').map(([k, v]) => `${k}: ${v}`).join(', ')}</span> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
