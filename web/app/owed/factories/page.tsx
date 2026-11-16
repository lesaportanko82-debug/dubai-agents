import Link from 'next/link';
import { getLang } from '@/lib/lang';
import { owedView } from '@/lib/owed-view';
import { PageTitle, Panel } from '@/components/ui';
import { BAND, money } from '@/components/owed/Bits';
import { saveWeights } from '../actions';

export const dynamic = 'force-dynamic';

const PART: { key: 'quality' | 'delivery' | 'claims' | 'response'; ru: string; en: string; color: string }[] = [
  { key: 'quality', ru: 'Качество', en: 'Quality', color: '#1F5A87' },
  { key: 'delivery', ru: 'Сроки', en: 'Delivery', color: '#2BB3E6' },
  { key: 'claims', ru: 'Претензии', en: 'Claims', color: '#5FA318' },
  { key: 'response', ru: 'Скорость ответа', en: 'Response', color: '#8A949B' },
];

export default async function FactoriesPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const v = await owedView();
  const w = v.settings.weights;
  const rows = [...v.rows].sort((a, b) => a.score.total - b.score.total);

  return (
    <>
      <PageTitle
        title={ru ? 'Заводы и рейтинг' : 'Factories & score'}
        lead={ru
          ? `Рейтинг поставщиков вместо впечатлений. Supplier Score 0–100 = качество ${w.quality}% + сроки ${w.delivery}% + претензии ${w.claims}% + скорость ответа ${w.response}%. Ниже ${v.settings.bands.control} — на контроль и поиск альтернативы, ${v.settings.bands.control}–${v.settings.bands.priority} — план улучшений, выше ${v.settings.bands.priority} — приоритет при новых заказах.`
          : `Supplier Score 0–100 = quality ${w.quality}% + delivery ${w.delivery}% + claims ${w.claims}% + response ${w.response}%. Below ${v.settings.bands.control}: on watch; ${v.settings.bands.control}–${v.settings.bands.priority}: improvement plan; above ${v.settings.bands.priority}: priority for new orders.`}
      />

      <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))' }}>
        {rows.map(r => {
          const b = BAND[r.score.band];
          return (
            <Panel key={r.s.id} className="flex flex-col">
              <div className="px-5 pt-5 pb-4 flex items-start gap-4">
                <div className="w-16 h-16 rounded-2xl flex flex-col items-center justify-center shrink-0 text-white" style={{ background: b.color }}>
                  <span className="num text-[26px] font-bold leading-none">{r.score.total}</span>
                  <span className="text-[10px] opacity-90">/ 100</span>
                </div>
                <div className="min-w-0">
                  <Link href={`/owed/factories/${r.s.code}`} className="font-semibold text-[16px] hover:underline">{r.s.code} · {r.s.name.replace(' (demo)', '')}</Link>
                  <div className="text-[13px] mt-0.5" style={{ color: b.color }}>{b[lang]}</div>
                  <div className="text-[12px] text-mute mt-0.5">{r.s.city} · {ru ? 'договор' : 'contract'} {r.contract?.number}{!r.contractReady && <span className="text-warn"> · {ru ? 'не разобран' : 'not analysed'}</span>}</div>
                </div>
              </div>
              <div className="px-5 pb-4 space-y-2">
                {PART.map(p => (
                  <div key={p.key} className="grid grid-cols-[120px_minmax(0,1fr)_32px] gap-2 items-center text-[13px]">
                    <span className="text-mute">{p[lang]} <span className="text-[11px]">· {w[p.key]}%</span></span>
                    <div className="h-2 rounded-full bg-stone-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${r.score.parts[p.key]}%`, background: p.color }} /></div>
                    <span className="num text-right">{r.score.parts[p.key]}</span>
                  </div>
                ))}
              </div>
              <div className="px-5 pb-5 mt-auto text-[12px] text-mute leading-relaxed border-t border-stone-100 pt-3">
                {ru ? 'Худшая партия' : 'Worst batch'} {r.score.facts.worstPct}% / {r.score.facts.allowedPct}% · {ru ? 'в срок' : 'on time'} {r.score.facts.onTimePct}% · {ru ? 'опоздание' : 'delay'} {r.score.facts.avgDelay} {ru ? 'дн.' : 'd'} · {ru ? 'претензий' : 'claims'} {r.score.facts.claimsSent}{r.score.facts.claimsSent ? ` (${ru ? 'признано' : 'accepted'} ${r.score.facts.claimsAccepted})` : ''}{r.score.facts.avgResponseDays != null ? ` · ${ru ? 'ответ за' : 'reply in'} ${r.score.facts.avgResponseDays} ${ru ? 'дн.' : 'd'}` : ''}
                <div className="mt-1">{ru ? 'Возвращено' : 'Recovered'} {money(r.recovered)} · {ru ? 'к предъявлению' : 'claimable'} {money(r.claimable)}</div>
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel className="mt-6" title={ru ? 'Веса рейтинга и пороги' : 'Score weights and bands'}>
        <form action={saveWeights} className="px-5 pb-5 flex flex-wrap gap-4 items-end text-[14px]">
          {PART.map(p => (
            <label key={p.key} className="flex flex-col gap-1">
              <span className="text-mute text-[13px]">{p[lang]}, %</span>
              <input name={p.key} type="number" min={0} max={100} defaultValue={w[p.key]} className="w-24 rounded-md border border-stone-300 bg-paper px-2 py-1.5" disabled={v.role !== 'management'} />
            </label>
          ))}
          <label className="flex flex-col gap-1"><span className="text-mute text-[13px]">{ru ? 'Контроль ниже' : 'Watch below'}</span><input name="control" type="number" min={0} max={100} defaultValue={v.settings.bands.control} className="w-24 rounded-md border border-stone-300 bg-paper px-2 py-1.5" disabled={v.role !== 'management'} /></label>
          <label className="flex flex-col gap-1"><span className="text-mute text-[13px]">{ru ? 'Приоритет выше' : 'Priority above'}</span><input name="priority" type="number" min={0} max={100} defaultValue={v.settings.bands.priority} className="w-24 rounded-md border border-stone-300 bg-paper px-2 py-1.5" disabled={v.role !== 'management'} /></label>
          <button className="rounded-md accent-bg text-white px-4 py-2 font-medium disabled:opacity-50" disabled={v.role !== 'management'}>{ru ? 'Сохранить' : 'Save'}</button>
          {v.role !== 'management' && <span className="text-[13px] text-mute">{ru ? 'Веса утверждает руководство — переключите роль слева.' : 'Weights are set by management — switch the role on the left.'}</span>}
        </form>
      </Panel>
    </>
  );
}
