import { domovoyState } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Pill } from '@/components/ui';
import { Avatar, LANG_LABEL, ROLE_LABEL } from '@/components/domovoy/Member';
import { buildContext } from '@core/domovoy/household';
import { loadRootEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
const DAYS = { ru: ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] };
const SKILL: Record<string, { ru: string; en: string }> = {
  drive: { ru: 'водит', en: 'drives' }, cook: { ru: 'готовит', en: 'cooks' }, shop: { ru: 'покупки', en: 'shopping' }, homework_help: { ru: 'уроки', en: 'homework' },
  water_plants: { ru: 'цветы', en: 'plants' }, pharmacy: { ru: 'аптека', en: 'pharmacy' }, repair: { ru: 'починить', en: 'repairs' }, tidy: { ru: 'уборка', en: 'tidying' },
  feed_cat: { ru: 'кот', en: 'cat' }, laundry: { ru: 'стирка', en: 'laundry' }, pickup_walk: { ru: 'забрать пешком', en: 'walk pickup' }, take_out_trash: { ru: 'мусор', en: 'trash' },
};

export default async function FamilyPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { store } = domovoyState();
  const members = await store.members();
  const ctx = await buildContext(store, new Date().toISOString());
  loadRootEnv();
  const tok = process.env.DOMOVOY_TELEGRAM_TOKEN?.trim();
  const bot: string | undefined = tok ? await fetch(`https://api.telegram.org/bot${tok}/getMe`, { cache: 'no-store' }).then(r => r.json()).then(j => j?.result?.username).catch(() => undefined) : undefined;

  return (
    <>
      <PageTitle title={ru ? 'Семья' : 'Family'} lead={ru ? 'Что Домовёнок знает о каждом и чем ограничен: язык, умения, часы, выходной, лимит дел в день.' : 'What Domovoy knows about each person and what limits it: language, skills, hours, day off, daily limit.'} />
      {bot && (
        <div className="mb-4"><Panel>
          <div className="px-5 py-4 text-[14px] flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>{ru ? 'Домовёнок в Telegram:' : 'Domovoy on Telegram:'} <a className="underline" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">@{bot}</a></span>
            <span className="text-mute">{ru ? 'Ссылки для входа каждого члена семьи:' : 'Join links per member:'}</span>
            {members.map(m => (
              <a key={m.id} className={`underline ${m.telegramId ? 'text-mute' : ''}`} href={`https://t.me/${bot}?start=${m.id}`} target="_blank" rel="noreferrer">{m.name}{m.telegramId ? ' ✓' : ''}</a>
            ))}
          </div>
        </Panel></div>
      )}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {members.map(m => (
          <Panel key={m.id}>
            <div className="px-5 py-4">
              <div className="flex items-center gap-3">
                <Avatar m={m} size={44} />
                <div>
                  <div className="font-semibold text-[16px]">{m.name}{m.age ? <span className="text-mute font-normal">, {m.age}</span> : ''}</div>
                  <div className="text-[13px] text-mute">{ROLE_LABEL[m.role][lang]} · {LANG_LABEL[m.lang]}</div>
                </div>
                {m.isAdmin && <Pill tone="stone">{ru ? 'настраивает правила' : 'sets rules'}</Pill>}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {m.skills.map(s => <Pill key={s} tone="accent">{SKILL[s]?.[lang] ?? s}</Pill>)}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                {m.workHours && <><dt className="text-mute">{ru ? 'Рабочие часы' : 'Working hours'}</dt><dd className="num">{m.workHours.from}–{m.workHours.to}</dd></>}
                {m.dayOff?.length ? <><dt className="text-mute">{ru ? 'Выходной' : 'Day off'}</dt><dd>{m.dayOff.map(d => DAYS[lang][d]).join(', ')}</dd></> : null}
                <dt className="text-mute">{ru ? 'Лимит дел в день' : 'Daily limit'}</dt><dd className="num">{m.dailyLimit}</dd>
                <dt className="text-mute">{ru ? 'Сделано за неделю' : 'Done this week'}</dt><dd className="num">{ctx.weekMinutes[m.id]} {ru ? 'мин' : 'min'}</dd>
                <dt className="text-mute">{ru ? 'Открыто сегодня' : 'Open today'}</dt><dd className="num">{ctx.openToday[m.id]}</dd>
              </dl>
              {m.role === 'helper' && <p className="mt-3 text-[12px] text-mute">{ru ? 'Дела вне рабочих часов и в выходной Домовёнок не назначит, даже если попросить.' : 'Domovoy will not assign tasks outside working hours or on the day off, even if asked.'}</p>}
              {m.role === 'child' && <p className="mt-3 text-[12px] text-mute">{ru ? 'Только безопасные короткие дела по возрасту. Очки, без сравнения с другими детьми.' : 'Only short, age-appropriate chores. Points, never comparison with other children.'}</p>}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
