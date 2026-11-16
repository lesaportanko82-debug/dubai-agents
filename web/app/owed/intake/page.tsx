import { owedContext } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { PageTitle } from '@/components/ui';
import { IntakeClient } from './IntakeClient';

export const dynamic = 'force-dynamic';

export default async function IntakePage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const runs = (await owedContext()).runs.slice(0, 10);
  return (
    <>
      <PageTitle
        title={ru ? 'Принять рекламацию' : 'Intake a complaint'}
        lead={ru ? 'Сообщение из любого из трёх источников — отзыв маркетплейса, рекламация, акт СЦ. Агент проверяет дубли, находит партию и завод (уровень A–D), определяет класс дефекта, а для уровня D просит у клиента фото этикетки. Справа видно каждый шаг.' : 'A message from any of the three systems — marketplace review, reclamation, service act. The agent checks duplicates, finds the batch and factory (level A–D), classifies the defect, and asks for a label photo at level D. Every step is on the right.'}
      />
      <IntakeClient lang={lang} initialRuns={JSON.parse(JSON.stringify(runs))} />
    </>
  );
}
