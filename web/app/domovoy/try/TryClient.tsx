'use client';
import { useState } from 'react';
import { TraceRail, type TraceStep } from '@/components/TraceRail';

interface Msg { toId: string; lang: string; text: string; kind: string }
interface Run { id: string; at: string; authorId: string; input: string; result: { summary: string; trace: TraceStep[]; redactions: number }; messages?: Msg[] }
interface MemberLite { id: string; name: string; role: string; lang: string }

const SAMPLES = [
  'Машу забрать из сада в 17:00, купить молоко и хлеб, и пусть кто-нибудь польёт цветы на балконе',
  'Завтра к 9 утра нужно отвезти бабушку в поликлинику и забрать её лекарства, а вечером постирать школьную форму',
  'Pick up the parcel from the post office before 6 pm and someone please feed the cat',
  'Купить торт ко дню рождения Маши к субботе, 15:00. Тимуру — убрать в комнате до прихода гостей',
];
const LANG_LABEL: Record<string, string> = { ru: 'русский', en: 'English', tl: 'Tagalog', ar: 'العربية', tr: 'Türkçe', hi: 'हिन्दी' };
const KIND: Record<string, { ru: string; en: string }> = { assignment: { ru: 'назначение', en: 'assignment' }, reminder: { ru: 'напоминание', en: 'reminder' }, swap: { ru: 'обмен', en: 'swap' }, info: { ru: 'инфо', en: 'info' }, report: { ru: 'отчёт', en: 'report' } };

export function TryClient({ lang, members, initialRuns }: { lang: 'ru' | 'en'; members: MemberLite[]; initialRuns: Run[] }) {
  const ru = lang === 'ru';
  const [authorId, setAuthorId] = useState('mum');
  const [text, setText] = useState(SAMPLES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const cur = runs[0];
  const name = (id: string) => members.find(m => m.id === id)?.name ?? id;

  async function run() {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/domovoy/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, authorId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setRuns(prev => [j, ...prev]);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-5 items-start">
      <div className="space-y-5">
        <section className="panel">
          <div className="px-5 pt-4 pb-2 font-semibold">{ru ? 'Сообщение Домовёнку' : 'Message to Domovoy'}</div>
          <div className="px-5 pb-5">
            <label className="text-[13px] text-mute">{ru ? 'От кого' : 'From'}
              <select value={authorId} onChange={e => setAuthorId(e.target.value)} className="block mt-1 mb-3 rounded-md border border-stone-300 bg-paper px-2 py-1.5 text-[14px] text-ink">
                {members.filter(m => m.role !== 'child').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5} className="w-full rounded-md border border-stone-300 bg-paper px-3 py-2 text-[14px]" placeholder={ru ? 'Как голосовое: что нужно сделать, к какому времени' : 'Like a voice note: what needs doing and by when'} />
            <div className="mt-2 flex flex-wrap gap-2">
              {SAMPLES.map((s, i) => <button key={i} type="button" onClick={() => setText(s)} className="text-[12px] rounded-full border border-stone-300 px-2.5 py-1 hover:border-stone-400 bg-paper">{ru ? `пример ${i + 1}` : `sample ${i + 1}`}</button>)}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button onClick={run} disabled={busy || !text.trim()} className="rounded-md accent-bg text-white px-4 py-2 text-[14px] font-medium disabled:opacity-50">{busy ? (ru ? 'Домовёнок думает…' : 'Domovoy is thinking…') : (ru ? 'Отправить' : 'Send')}</button>
              <span className="text-[13px] text-mute">{ru ? 'Телефоны и адреса скрываются до модели.' : 'Phones and addresses are masked before the model.'}</span>
            </div>
            {error && <div className="mt-3 text-bad text-[13px]">{error}</div>}
          </div>
        </section>

        {cur?.messages && cur.messages.length > 0 && (
          <section className="panel">
            <div className="px-5 pt-4 pb-2 font-semibold">{ru ? 'Что получил каждый' : 'What each person received'}</div>
            <ul className="px-5 pb-5 space-y-3">
              {cur.messages.map((m, i) => (
                <li key={i} className="rise" style={{ animationDelay: `${0.6 * (cur.result.trace.length + 1) + i * 0.25}s` }}>
                  <div className="text-[12px] text-mute mb-1">→ <b className="text-ink">{name(m.toId)}</b> · {LANG_LABEL[m.lang] ?? m.lang} · {KIND[m.kind]?.[lang] ?? m.kind}</div>
                  <div className="rounded-2xl rounded-tl-sm accent-wash px-4 py-2.5 text-[14px] max-w-[46ch]">{m.text}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section className="panel">
        <div className="px-5 pt-4 pb-2 flex items-baseline justify-between">
          <span className="font-semibold">{ru ? 'Как решал Домовёнок' : 'How Domovoy decided'}</span>
          {cur && <span className="text-[12px] text-mute">{cur.result.redactions > 0 ? (ru ? `скрыто личных данных: ${cur.result.redactions}` : `personal data masked: ${cur.result.redactions}`) : ''}</span>}
        </div>
        <div className="px-5 pb-5">
          {!cur ? (
            <div className="text-mute py-8 text-center">{ru ? 'Здесь появятся шаги: кого рассмотрел, кого отсеял и почему, кому что отправил.' : 'Steps will appear here: who was considered, who was ruled out and why, who got what.'}</div>
          ) : (
            <>
              <TraceRail key={cur.id} steps={cur.result.trace} lang={lang} summary={cur.result.summary} />
              <div className="mt-4 text-[12px] text-mute">{ru ? 'Кандидатов и запреты считает код (возраст, рабочие часы, выходной, календарь, очередь). Модель выбирает только из разрешённых и пишет сообщения.' : 'Candidates and blocks are computed by code (age, working hours, day off, calendar, fairness). The model only picks among the allowed and writes the messages.'}</div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
