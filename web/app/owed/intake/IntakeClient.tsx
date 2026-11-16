'use client';
import { useState } from 'react';
import { TraceRail, type TraceStep } from '@/components/TraceRail';

interface Run { id: string; at: string; input: string; channel?: string; result: { summary: string; trace: TraceStep[]; redactions: number; duplicate?: boolean; merged?: boolean; case?: { id: string; status: string; level?: string; cost: { total: number }; sku: string; sources?: { source: string; ref: string }[] } } }

const SAMPLES: { text: string; channel: string; ru: string; en: string }[] = [
  { channel: 'telegram', ru: 'рекламация · A', en: 'reclamation · A', text: 'Смеситель MX-210 серия 102311 течёт из-под картриджа через 2 месяца, звоните +7 701 123 45 67' },
  { channel: 'marketplace', ru: 'отзыв МП · B', en: 'MP review · B', text: 'Отзыв Wildberries, заказ WB-90001: душевая система SH-120, термостат через 6 недель начал подтекать, 2 фото.' },
  { channel: 'service_act', ru: 'акт СЦ · дубль', en: 'SC act · duplicate', text: 'Акт СЦ-9001 по заказу WB-90001, SH-120: течь термостатического картриджа, замена картриджа, работа 12 USD.' },
  { channel: 'telegram', ru: 'нет данных · D', en: 'no data · D', text: 'Смеситель на кухне течёт под ручкой, модель не знаю, чека нет. Ул. Абая 10, кв 5.' },
  { channel: 'email', ru: 'монтаж', en: 'installation', text: 'Сантехник перетянул накидную гайку на кране VL-15 (серия 901233), гайка лопнула при установке.' },
];

export function IntakeClient({ lang, initialRuns }: { lang: 'ru' | 'en'; initialRuns: Run[] }) {
  const ru = lang === 'ru';
  const [text, setText] = useState(SAMPLES[0].text);
  const [channel, setChannel] = useState(SAMPLES[0].channel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const current = runs[0];

  async function run() {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/owed/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, channel }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setRuns(prev => [j, ...prev]);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-5 items-start">
      <section className="panel">
        <div className="px-5 pt-4 pb-2 font-semibold">{ru ? 'Рекламация как она пришла' : 'The complaint as it arrived'}</div>
        <div className="px-5 pb-5">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6} className="w-full rounded-md border border-stone-300 bg-paper px-3 py-2 text-[14px]" />
          <div className="mt-2 flex flex-wrap gap-2">
            {SAMPLES.map((s, i) => (
              <button key={i} type="button" onClick={() => { setText(s.text); setChannel(s.channel); }} className={`text-[12px] rounded-full border px-2.5 py-1 bg-paper ${text === s.text ? 'border-stone-500' : 'border-stone-300 hover:border-stone-400'}`}>{ru ? s.ru : s.en}</button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[13px]">
            <label htmlFor="ch" className="text-mute">{ru ? 'Источник' : 'Source'}</label>
            <select id="ch" value={channel} onChange={e => setChannel(e.target.value)} className="rounded-md border border-stone-300 bg-paper px-2 py-1">
              <option value="marketplace">{ru ? 'CRM маркетплейсов' : 'Marketplace CRM'}</option>
              <option value="telegram">{ru ? 'Рекламации (Telegram)' : 'Reclamations (Telegram)'}</option>
              <option value="email">{ru ? 'Рекламации (почта)' : 'Reclamations (e-mail)'}</option>
              <option value="service_act">{ru ? 'CRM сервисного центра' : 'Service-centre CRM'}</option>
            </select>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={run} disabled={busy || !text.trim()} className="rounded-md accent-bg text-white px-4 py-2 text-[14px] font-medium disabled:opacity-50">
              {busy ? (ru ? 'Агент работает…' : 'Agent is working…') : (ru ? 'Отдать агенту' : 'Hand to the agent')}
            </button>
            <span className="text-[13px] text-mute">{ru ? 'Телефоны и адреса будут скрыты до отправки модели.' : 'Phones and addresses are masked before the model sees the text.'}</span>
          </div>
          {error && <div className="mt-3 text-bad text-[13px]">{error}</div>}
        </div>
        {runs.length > 1 && (
          <div className="border-t border-stone-100 px-5 py-3">
            <div className="text-[12px] text-mute mb-2">{ru ? 'Предыдущие прогоны' : 'Earlier runs'}</div>
            <ul className="space-y-1 text-[13px]">
              {runs.slice(1, 8).map(r => (
                <li key={r.id}><button className="text-left hover:underline text-ink-soft" onClick={() => setRuns(prev => [r, ...prev.filter(x => x.id !== r.id)])}>{r.at.slice(11, 16)} — {r.input.slice(0, 70)}</button></li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="font-semibold">{ru ? 'Что делал агент' : 'What the agent did'}</span>
          {current && <span className="text-[12px] text-mute">{current.result.redactions > 0 ? (ru ? `скрыто личных данных: ${current.result.redactions}` : `personal data masked: ${current.result.redactions}`) : ''}</span>}
        </div>
        <div className="px-5 pb-5">
          {!current ? (
            <div className="text-mute py-8 text-center">{ru ? 'Здесь появятся шаги агента: какой инструмент вызвал, что получил, что решил.' : 'Agent steps will appear here: which tool it called, what it got, what it decided.'}</div>
          ) : (
            <>
              <TraceRail key={current.id} steps={current.result.trace} lang={lang} summary={current.result.summary} />
              {current.result.case && (
                <div className="mt-5 rounded-md accent-wash px-4 py-3 text-[14px] flex flex-wrap gap-x-6 gap-y-1">
                  <span><span className="text-mute">{ru ? 'Случай' : 'Case'}</span> <b>{current.result.case.sku}</b></span>
                  {current.result.case.level && <span><span className="text-mute">{ru ? 'Уровень' : 'Level'}</span> <b>{current.result.case.level}</b></span>}
                  <span><span className="text-mute">{ru ? 'Статус' : 'Status'}</span> <b>{current.result.case.status}</b></span>
                  {current.result.merged && <span className="text-info font-medium">{ru ? `дубль: объединён, источников ${current.result.case.sources?.length ?? 2}` : `duplicate merged, ${current.result.case.sources?.length ?? 2} sources`}</span>}
                  <span><span className="text-mute">{ru ? 'Стоимость' : 'Cost'}</span> <b className="num">{current.result.case.cost.total} USD</b></span>
                  <a href={['needs_review', 'analytics_only', 'awaiting_label'].includes(current.result.case.status) ? '/owed/review' : '/owed/cases'} className="ml-auto underline underline-offset-2">{['needs_review', 'analytics_only', 'awaiting_label'].includes(current.result.case.status) ? (ru ? 'Открыть очередь проверки' : 'Open review queue') : (ru ? 'Открыть реестр' : 'Open the registry')}</a>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
