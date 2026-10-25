import type { DefectCase } from '@core/owed/types';
import { Edge, Money, Pill } from '@/components/ui';

export const CLASS_LABEL: Record<string, { ru: string; en: string }> = {
  manufacturing: { ru: 'производственный', en: 'manufacturing' },
  transport: { ru: 'транспорт', en: 'transport' },
  installation: { ru: 'монтаж / эксплуатация', en: 'installation / misuse' },
  unknown: { ru: 'неясно', en: 'unknown' },
};
export const STATUS_LABEL: Record<string, { ru: string; en: string }> = {
  evidenced: { ru: 'доказано', en: 'evidenced' },
  claimed: { ru: 'предъявлено', en: 'claimed' },
  offered: { ru: 'предложено', en: 'offered' },
  recovered: { ru: 'возвращено', en: 'recovered' },
  needs_review: { ru: 'на проверку', en: 'needs review' },
  not_recoverable: { ru: 'не к заводу', en: 'not recoverable' },
  written_off: { ru: 'списано', en: 'written off' },
  new: { ru: 'новое', en: 'new' },
};
const CHANNEL: Record<string, string> = { telegram: 'Telegram', email: 'Email', service_act: 'СЦ', marketplace: 'MP', test: 'test', cli: 'cli', web: 'web', eval: 'eval' };

export function CaseRow({ c, lang, supplierCode, batchCode, actions }: { c: DefectCase; lang: 'ru' | 'en'; supplierCode?: string; batchCode?: string; actions?: React.ReactNode }) {
  const ru = lang === 'ru';
  return (
    <Edge status={c.status} className="px-5 py-3 grid md:grid-cols-[112px_72px_1fr_auto] gap-x-4 gap-y-1 items-start border-b border-stone-100 last:border-0">
      <div className="num text-[13px] text-mute whitespace-nowrap">
        {c.receivedAt.slice(0, 10)}
        <div>{CHANNEL[c.channel] ?? c.channel}{c.externalRef ? ` · ${c.externalRef}` : ''}</div>
      </div>
      <div className="font-semibold">
        {c.sku}
        {c.serial ? <div className="num text-[12px] text-mute font-normal">#{c.serial}</div> : <div className="text-[12px] text-mute font-normal">{ru ? 'без серии' : 'no serial'}</div>}
      </div>
      <div className="min-w-0">
        <div className="truncate">{c.description}</div>
        <div className="text-[13px] text-mute mt-0.5 flex flex-wrap gap-x-2 gap-y-1 items-center">
          <Pill tone={c.defectClass === 'manufacturing' ? 'ok' : c.defectClass === 'unknown' ? 'warn' : 'stone'}>{CLASS_LABEL[c.defectClass]?.[lang]} · {Math.round(c.confidence * 100)}%</Pill>
          {batchCode && <span>{batchCode}{supplierCode ? ` → ${supplierCode}` : ''}</span>}
          {c.attribution === 'sku_latest_batch_guess' && <span className="text-warn">{ru ? 'партия предположена' : 'batch guessed'}</span>}
          <span className="text-ink-soft">{c.reasoning}</span>
        </div>
      </div>
      <div className="text-right md:min-w-[150px]">
        <Money v={c.cost.total} className="font-semibold" />
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--edge)' }}>{STATUS_LABEL[c.status]?.[lang]}</div>
      </div>
      {actions && <div className="md:col-span-4 flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
    </Edge>
  );
}
