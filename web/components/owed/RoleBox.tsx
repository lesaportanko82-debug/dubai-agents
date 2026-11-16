import { owedContext, ROLES, ROLE_LABEL } from '@/lib/owed-server';
import { setRole, resetDemo } from '@/app/owed/actions';

const CAN: Record<string, { ru: string; en: string }> = {
  buyer: { ru: 'собирает и отправляет претензии, подтверждает договоры', en: 'builds and sends claims, confirms contracts' },
  quality: { ru: 'проверяет случаи, собирает черновики претензий', en: 'reviews cases, drafts claims' },
  service: { ru: 'вносит акты, проверяет случаи', en: 'enters service acts, reviews cases' },
  management: { ru: 'дашборд потерь, веса рейтинга, эскалации', en: 'loss dashboard, score weights, escalations' },
};

/** Demo role switcher: what each role may do is enforced on the server. */
export async function OwedRoleBox({ lang }: { lang: 'ru' | 'en' }) {
  const { role, persistent } = await owedContext();
  const ru = lang === 'ru';
  return (
    <div className="mx-3 mb-4 rounded-card border border-stone-200 bg-paper p-3 text-[13px] flex flex-col gap-2">
      <form action={setRole} className="flex flex-col gap-1.5">
        <label htmlFor="owed-role" className="text-mute">{ru ? 'Вы работаете как' : 'You work as'}</label>
        <div className="flex gap-1.5">
          <select id="owed-role" name="role" defaultValue={role} className="flex-1 min-w-0 rounded-md border border-stone-300 bg-paper px-2 py-1.5">
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r][lang]}</option>)}
          </select>
          <button className="rounded-md border border-stone-300 px-2.5 py-1.5 font-medium">{ru ? 'ок' : 'ok'}</button>
        </div>
      </form>
      <p className="text-mute leading-snug m-0">{CAN[role][lang]}</p>
      <form action={resetDemo}>
        <button className="underline underline-offset-2 text-mute">{ru ? 'сбросить демо-данные' : 'reset demo data'}</button>
      </form>
      {!persistent && <p className="text-[12px] text-warn m-0">{ru ? 'База не подключена: данные в памяти.' : 'No database: data is in memory.'}</p>}
    </div>
  );
}
