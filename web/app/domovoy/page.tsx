import { PageTitle, Panel, Empty } from '@/components/ui';
import { getLang } from '@/lib/lang';

export default async function DomovoyHome() {
  const lang = await getLang();
  const ru = lang === 'ru';
  return (
    <>
      <PageTitle title={ru ? 'Сегодня в доме' : 'Today at home'} />
      <Panel>
        <Empty>{ru ? 'Ядро «Домовёнка» подключается.' : 'Domovoy core is being connected.'}</Empty>
      </Panel>
    </>
  );
}
