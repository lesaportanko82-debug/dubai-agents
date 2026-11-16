import type { ReactNode } from 'react';
import type { AttributionLevel, CaseStatus, ClaimStatus, DefectClass, SignalSource } from '@core/owed/types';

type L = 'ru' | 'en';

export const LEVEL: Record<AttributionLevel, { ru: string; en: string; bg: string; fg: string; hint: { ru: string; en: string } }> = {
  A: { ru: 'A · подтверждено', en: 'A · confirmed', bg: '#E3F1E1', fg: '#2C5A2B', hint: { ru: 'серийный номер или номер партии на этикетке', en: 'serial or batch code on the label' } },
  B: { ru: 'B · вычислено', en: 'B · computed', bg: '#E2EEF5', fg: '#1D4A61', hint: { ru: 'заказ → дата отгрузки → один завод на складе', en: 'order → ship date → one factory in stock' } },
  C: { ru: 'C · вероятно', en: 'C · probable', bg: '#FFF1DC', fg: '#7A4510', hint: { ru: 'несколько заводов — только аналитика', en: 'several factories — analytics only' } },
  D: { ru: 'D · неизвестно', en: 'D · unknown', bg: '#F7E4E4', fg: '#7A2A2A', hint: { ru: 'нет данных — запрошено фото этикетки', en: 'no data — label photo requested' } },
};

export function LevelBadge({ level, lang, short }: { level?: AttributionLevel; lang: L; short?: boolean }) {
  if (!level) return null;
  const l = LEVEL[level];
  return <span title={l.hint[lang]} className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[12px] font-semibold whitespace-nowrap" style={{ background: l.bg, color: l.fg }}>{short ? level : l[lang]}</span>;
}

export const SOURCE: Record<SignalSource, { ru: string; en: string }> = {
  marketplace: { ru: 'МП', en: 'MP' },
  reclamation: { ru: 'Рекл.', en: 'Recl.' },
  service_center: { ru: 'СЦ', en: 'SC' },
};

export function Sources({ sources, lang }: { sources?: { source: SignalSource; ref: string }[]; lang: L }) {
  if (!sources?.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sources.map((s, i) => (
        <span key={i} title={s.ref} className="text-[11px] rounded px-1.5 py-0.5 border border-stone-200 bg-paper text-ink-soft whitespace-nowrap">{SOURCE[s.source][lang]} · {s.ref}</span>
      ))}
      {sources.length > 1 && <span className="text-[11px] text-mute self-center">{lang === 'ru' ? `один случай из ${sources.length} сообщений` : `one case from ${sources.length} messages`}</span>}
    </span>
  );
}

export const CLASS: Record<DefectClass, { ru: string; en: string }> = {
  manufacturing: { ru: 'производственный', en: 'manufacturing' },
  transport: { ru: 'транспорт', en: 'transport' },
  installation: { ru: 'монтаж / эксплуатация', en: 'installation / use' },
  unknown: { ru: 'неясно', en: 'unknown' },
};

export const CASE_STATUS: Record<CaseStatus, { ru: string; en: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'stone' }> = {
  new: { ru: 'новый', en: 'new', tone: 'stone' },
  needs_review: { ru: 'на проверку', en: 'needs review', tone: 'warn' },
  evidenced: { ru: 'доказано', en: 'evidenced', tone: 'ok' },
  claimed: { ru: 'предъявлено', en: 'claimed', tone: 'info' },
  offered: { ru: 'признано заводом', en: 'acknowledged', tone: 'info' },
  recovered: { ru: 'возмещено', en: 'recovered', tone: 'ok' },
  written_off: { ru: 'списано', en: 'written off', tone: 'stone' },
  not_recoverable: { ru: 'не к заводу', en: 'not the factory', tone: 'stone' },
  analytics_only: { ru: 'только аналитика', en: 'analytics only', tone: 'warn' },
  awaiting_label: { ru: 'ждём фото этикетки', en: 'awaiting label', tone: 'bad' },
};

export const CLAIM_STATUS: Record<ClaimStatus, { ru: string; en: string; bg: string; fg: string }> = {
  draft: { ru: 'черновик', en: 'draft', bg: '#EFEDE7', fg: '#3E4A45' },
  reviewed: { ru: 'проверено закупщиком', en: 'reviewed', bg: '#E2EEF5', fg: '#1D4A61' },
  sent: { ru: 'отправлено', en: 'sent', bg: '#E8E3F5', fg: '#47337A' },
  acknowledged: { ru: 'признано', en: 'acknowledged', bg: '#E3F1E1', fg: '#2C5A2B' },
  disputed: { ru: 'оспорено', en: 'disputed', bg: '#FFF1DC', fg: '#7A4510' },
  paid: { ru: 'выплачено', en: 'paid', bg: '#D6EBD3', fg: '#1F4A1E' },
  legal: { ru: 'у юриста', en: 'with legal', bg: '#F7E4E4', fg: '#7A2A2A' },
  withdrawn: { ru: 'отозвано', en: 'withdrawn', bg: '#EFEDE7', fg: '#6B7570' },
};

export function ClaimBadge({ status, lang }: { status: ClaimStatus; lang: L }) {
  const s = CLAIM_STATUS[status];
  return <span className="inline-block rounded-md px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{s[lang]}</span>;
}

export const BAND: Record<'control' | 'improve' | 'priority', { ru: string; en: string; color: string }> = {
  control: { ru: 'на контроль, искать альтернативу', en: 'on watch, look for alternatives', color: '#C2412D' },
  improve: { ru: 'план улучшений', en: 'improvement plan', color: '#B7791F' },
  priority: { ru: 'приоритет при заказах', en: 'priority for new orders', color: '#2F7D4F' },
};

export function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-mute">{label}</div>
      <div className="text-[24px] font-semibold leading-tight num">{children}</div>
      {sub && <div className="text-[12px] text-mute mt-0.5">{sub}</div>}
    </div>
  );
}

/** Rate vs allowance: the bar, the allowance tick, red when over. */
export function RateBar({ pct, allowed, max }: { pct: number; allowed: number; max: number }) {
  const over = pct > allowed;
  return (
    <div className="relative h-3 w-full rounded-sm bg-stone-100" aria-hidden="true">
      <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.min(100, (100 * pct) / max)}%`, background: over ? '#C2412D' : '#2F7D4F' }} />
      <div className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `${Math.min(100, (100 * allowed) / max)}%` }} />
    </div>
  );
}

export const money = (v: number, cur = 'USD') => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v)} ${cur}`;
export const date = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '—');
