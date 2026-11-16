import type { DefectCase } from '@core/owed/types';
import { DEFECT_RU } from '@core/owed/sqpm';
import { CASE_STATUS, CLASS, LevelBadge, Sources, date } from './Bits';
import { Edge, Pill } from '@/components/ui';

/** Back-compat label map used by older pages. */
export const STATUS_LABEL: Record<string, { ru: string; en: string }> = Object.fromEntries(Object.entries(CASE_STATUS).map(([k, v]) => [k, { ru: v.ru, en: v.en }]));

export function CaseRow({ c, lang, supplierCode, batchCode, candidates, children }: {
  c: DefectCase; lang: 'ru' | 'en'; supplierCode?: string; batchCode?: string; candidates?: string[]; children?: React.ReactNode;
}) {
  const ru = lang === 'ru';
  const st = CASE_STATUS[c.status];
  const claimable = c.level === 'A' || c.level === 'B';
  return (
    <Edge status={c.status} className="border-b border-stone-100 last:border-0">
      <div className="px-5 py-3 grid gap-x-4 gap-y-1.5 md:grid-cols-[96px_minmax(0,1fr)_auto] items-start text-[14px]">
        <div className="text-[12px] text-mute">
          <div className="num">{date(c.receivedAt)}</div>
          <div className="font-semibold text-ink text-[13px]">{c.sku}</div>
          {c.serial ? <div className="num">#{c.serial}</div> : c.orderNo ? <div>{c.orderNo}</div> : <div>{ru ? 'без серии' : 'no serial'}</div>}
        </div>
        <div className="min-w-0">
          <div className="leading-snug">{c.description}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
            <LevelBadge level={c.level} lang={lang} />
            <Pill tone={c.defectClass === 'manufacturing' ? 'accent' : c.defectClass === 'unknown' ? 'warn' : 'stone'}>{CLASS[c.defectClass][lang]} · {Math.round(c.confidence * 100)}%</Pill>
            {c.defectCode && c.defectClass === 'manufacturing' && <span>{ru ? DEFECT_RU[c.defectCode] : c.defectCode.replace('_', ' ')}</span>}
            <span className="num">
              {claimable && batchCode ? `${batchCode} → ${supplierCode ?? '—'}` : candidates?.length ? `${ru ? 'возможно' : 'maybe'}: ${candidates.join(' / ')}` : ru ? 'партия неизвестна' : 'batch unknown'}
            </span>
          </div>
          <div className="mt-1.5"><Sources sources={c.sources} lang={lang} /></div>
          {c.reviewReasons.length > 0 && c.status !== 'evidenced' && <div className="mt-1 text-[12px] text-warn">{c.reviewReasons.join(' · ')}</div>}
          {children}
        </div>
        <div className="md:text-right flex md:flex-col gap-2 md:gap-0.5 items-baseline md:items-end">
          <span className="num font-semibold">{c.cost.total.toFixed(0)} <span className="text-mute text-[12px]">USD</span></span>
          <Pill tone={st.tone}>{st[lang]}</Pill>
          {c.photos ? <span className="text-[12px] text-mute">{c.photos} {ru ? 'фото' : 'photos'}</span> : null}
        </div>
      </div>
    </Edge>
  );
}
