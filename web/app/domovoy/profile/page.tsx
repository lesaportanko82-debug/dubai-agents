import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Pill, Empty } from '@/components/ui';
import { Avatar } from '@/components/domovoy/Member';
import { visibleFacts, type FactKind, type FactAccess } from '@core/domovoy/profile';
import { factAction, forgetAction } from '../loop-actions';

export const dynamic = 'force-dynamic';

const KIND: Record<FactKind, { ru: string; en: string; icon: string }> = {
  place: { ru: 'Места', en: 'Places', icon: '📍' }, person: { ru: 'О людях', en: 'About people', icon: '👤' }, rule: { ru: 'Правила', en: 'Rules', icon: '📏' },
  recurring: { ru: 'Повторяющееся', en: 'Recurring', icon: '🔁' }, other: { ru: 'Прочее', en: 'Other', icon: '•' },
};
const ACCESS: Record<FactAccess, { ru: string; en: string; tone: 'stone' | 'warn' | 'bad' }> = {
  family: { ru: 'вся семья', en: 'family', tone: 'stone' }, adults: { ru: 'только взрослые', en: 'adults only', tone: 'warn' }, owner: { ru: 'владелец + родители', en: 'owner + parents', tone: 'bad' },
};

export default async function ProfilePage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const ctx = await panelContext();
  const { store } = ctx;
  const members = await store.members();
  const me = ctx.member ?? members.find(m => m.isAdmin) ?? members[0];
  const facts = await visibleFacts(store, me);
  const all = await store.profile();
  const hidden = all.length - facts.length;
  const sealed = !!process.env.PROFILE_KEY;
  const groups = (Object.keys(KIND) as FactKind[]).map(k => ({ k, items: facts.filter(f => f.kind === k).sort((a, b) => a.key.localeCompare(b.key)) })).filter(g => g.items.length);

  return (
    <>
      <PageTitle
        title={ru ? 'Профиль семьи' : 'Family profile'}
        lead={ru ? `Цифровой двойник дома: места, факты о людях, правила. Наполняется по принципу «спросил один раз». Вы видите как ${me.name}${hidden ? `; ещё ${hidden} ${hidden === 1 ? 'факт скрыт' : 'фактов скрыто'} уровнем доступа` : ''}. Медицинское ${sealed ? 'зашифровано отдельным ключом' : 'хранится без шифрования — задайте PROFILE_KEY'}.` : `The home's digital twin: places, facts about people, rules. Filled ask-once. You see it as ${me.name}${hidden ? `; ${hidden} more fact${hidden === 1 ? ' is' : 's are'} hidden by access level` : ''}. Medical facts are ${sealed ? 'sealed with a separate key' : 'stored unsealed — set PROFILE_KEY'}.`}
      />

      <div className="grid md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 items-start">
        <div className="space-y-5">
          {groups.length === 0 && <Panel><Empty>{ru ? 'Пока пусто. Агент спросит нужное сам, когда понадобится, — или добавьте справа.' : 'Empty so far. The agent will ask for what it needs — or add on the right.'}</Empty></Panel>}
          {groups.map(g => (
            <Panel key={g.k} title={`${KIND[g.k].icon} ${ru ? KIND[g.k].ru : KIND[g.k].en}`}>
              <ul className="px-5 pb-4 divide-y divide-stone-100 text-[14px]">
                {g.items.map(f => {
                  const about = f.aboutMemberId ? members.find(m => m.id === f.aboutMemberId) : undefined;
                  return (
                    <li key={f.key} className="py-2.5 flex items-start gap-3">
                      {about ? <Avatar m={about} size={22} /> : <span className="w-[22px]" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><code className="text-[12px] bg-stone-100 rounded px-1.5 py-0.5">{f.key}</code><Pill tone={ACCESS[f.access].tone}>{ru ? ACCESS[f.access].ru : ACCESS[f.access].en}</Pill>{f.source === 'learned' && <Pill tone="info">{ru ? 'выучено' : 'learned'}</Pill>}{f.sealed && <Pill tone="ok">🔐</Pill>}</div>
                        <div className="mt-0.5">{f.value}</div>
                        <div className="text-[12px] text-mute mt-0.5">{f.createdBy === 'agent' ? (ru ? 'Домовёнок' : 'Domovoy') : members.find(m => m.id === f.createdBy)?.name ?? f.createdBy} · {f.updatedAt.slice(0, 10)}</div>
                      </div>
                      {me.isAdmin && <form action={forgetAction}><input type="hidden" name="key" value={f.key} /><button className="text-[12px] text-mute underline">{ru ? 'забыть' : 'forget'}</button></form>}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>

        <div className="space-y-5">
          <Panel title={ru ? 'Добавить факт' : 'Add a fact'}>
            <form action={factAction} className="px-5 pb-5 space-y-2 text-[14px]">
              <input name="key" placeholder={ru ? 'ключ: home, school:masha, shoe_size:son' : 'key: home, school:masha, shoe_size:son'} className="w-full rounded border border-stone-300 px-2 py-1.5 text-[13px] font-mono" />
              <input name="value" placeholder={ru ? 'значение' : 'value'} className="w-full rounded border border-stone-300 px-2 py-1.5 text-[13px]" />
              <button className="rounded-md accent-bg text-white px-3 py-1.5 text-[13px] font-medium">{ru ? 'запомнить' : 'remember'}</button>
              <p className="text-[12px] text-mute">{ru ? 'После «:» — id члена семьи: ' : 'After ":" — a member id: '}{members.map(m => `${m.id} (${m.name})`).join(', ')}. {ru ? 'Медицинские ключи (allergy, health, medication) видят только взрослые.' : 'Medical keys (allergy, health, medication) are adults-only.'}</p>
            </form>
          </Panel>
          <Panel title={ru ? 'Кто что видит' : 'Who sees what'}>
            <div className="px-5 pb-5 text-[13px] text-mute space-y-1.5">
              <p>{ru ? '📍 Места и правила — вся семья, включая помощницу.' : '📍 Places and rules — the whole family, helper included.'}</p>
              <p>{ru ? '👤 Личное (размеры, телефоны) — сам человек и родители.' : '👤 Personal (sizes, phones) — the person and the parents.'}</p>
              <p>{ru ? '🔒 Медицинское — только взрослые; в промпт модели не попадает, запрашивается точечно перед заказом еды или лекарств.' : '🔒 Medical — adults only; never in the model prompt, fetched only before food or medicine orders.'}</p>
              <p>{ru ? '🌍 Наружу — только с одобрения родителей (чекпоинт share_outside).' : '🌍 Outside the family — only with the parents\' approval (share_outside checkpoint).'}</p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
