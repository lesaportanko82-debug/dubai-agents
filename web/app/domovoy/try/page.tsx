import { domovoyState } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle } from '@/components/ui';
import { TryClient } from './TryClient';

export const dynamic = 'force-dynamic';

export default async function TryPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store, runs } = domovoyState();
  const members = (await store.members()).map(m => ({ id: m.id, name: m.name, role: m.role, lang: m.lang }));
  return (
    <>
      <PageTitle
        title={ru ? 'Попробовать' : 'Try it'}
        lead={ru ? 'В жизни это голосовое в Telegram или WhatsApp. Здесь — то же самое текстом: напишите, что нужно сделать, и смотрите, кому и что отправит Домовёнок.' : 'In real life this is a voice note in Telegram or WhatsApp. Here it is the same in text: say what needs doing and watch who Domovoy messages, and how.'}
      />
      <TryClient lang={lang} members={members} initialRuns={JSON.parse(JSON.stringify(runs.slice(0, 10)))} />
    </>
  );
}
