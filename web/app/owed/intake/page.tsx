import { owedState } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { PageTitle } from '@/components/ui';
import { IntakeClient } from './IntakeClient';

export const dynamic = 'force-dynamic';

export default async function IntakePage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const runs = owedState().runs.slice(0, 10);
  return (
    <>
      <PageTitle
        title={ru ? 'Принять рекламацию' : 'Intake a complaint'}
        lead={ru ? 'То же, что сотрудник делает в Telegram: пересылает рекламацию, а агент разбирает её сам. Справа видно каждый шаг.' : 'The same thing staff do in Telegram: forward a complaint and the agent handles it. Every step is visible on the right.'}
      />
      <IntakeClient lang={lang} initialRuns={JSON.parse(JSON.stringify(runs))} />
    </>
  );
}
