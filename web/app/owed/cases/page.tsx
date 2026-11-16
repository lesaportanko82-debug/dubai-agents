import Link from 'next/link';
import { owedContext } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Empty } from '@/components/ui';
import { CaseRow } from '@/components/owed/CaseRow';
import { CASE_STATUS, LEVEL, SOURCE } from '@/components/owed/Bits';
import type { AttributionLevel, CaseStatus, SignalSource } from '@core/owed/types';

export const dynamic = 'force-dynamic';

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ supplier?: string; status?: string; level?: string; source?: string; batch?: string; limit?: string }> }) {
  const lang = await getLang();
  const ru = lang === 'ru';
  const sp = await searchParams;
  const { store } = await owedContext();
  const [suppliers, batches, all] = await Promise.all([store.suppliers(), store.batches(), store.cases()]);
  const supById = new Map(suppliers.map(s => [s.id, s]));
  const batchById = new Map(batches.map(b => [b.id, b]));
  const limit = Math.min(400, Number(sp.limit) || 60);

  let cases = [...all].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  if (sp.supplier) cases = cases.filter(c => supById.get(c.supplierId ?? '')?.code === sp.supplier || (c.candidateSupplierIds ?? []).some(id => supById.get(id)?.code === sp.supplier));
  if (sp.status) cases = cases.filter(c => c.status === sp.status);
  if (sp.level) cases = cases.filter(c => c.level === sp.level);
  if (sp.source) cases = cases.filter(c => (c.sources ?? []).some(s => s.source === sp.source));
  if (sp.batch) cases = cases.filter(c => batchById.get(c.batchId ?? '')?.code === sp.batch);
  const merged = all.filter(c => (c.sources?.length ?? 0) > 1).length;

  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ supplier: sp.supplier, status: sp.status, level: sp.level, source: sp.source, batch: sp.batch, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return `/owed/cases${s ? `?${s}` : ''}`;
  };
  const chip = (href: string, label: string, active: boolean) => (
    <Link key={href + label} href={href} className={`rounded-full px-3 py-1 text-[13px] border whitespace-nowrap ${active ? 'accent-bg text-white border-transparent' : 'border-stone-300 bg-paper hover:border-stone-400'}`}>{label}</Link>
  );

  return (
    <>
      <PageTitle
        title={ru ? 'Реестр случаев' : 'Case registry'}
        lead={ru
          ? `Единый реестр доказательств: SKU → партия → завод → договор → дефект → ущерб. ${merged} случаев собраны из нескольких сообщений — один дефект не считается дважды.`
          : `One evidence registry: SKU → batch → factory → contract → defect → damage. ${merged} cases were merged from several messages — a defect is never counted twice.`}
      />
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex flex-wrap gap-2">
          {chip(q({ supplier: undefined }), ru ? 'Все заводы' : 'All factories', !sp.supplier)}
          {suppliers.map(s => chip(q({ supplier: s.code }), s.code, sp.supplier === s.code))}
        </div>
        <div className="flex flex-wrap gap-2">
          {chip(q({ level: undefined }), ru ? 'Все уровни' : 'All levels', !sp.level)}
          {(['A', 'B', 'C', 'D'] as AttributionLevel[]).map(l => chip(q({ level: l }), LEVEL[l][lang], sp.level === l))}
          <span className="w-px bg-stone-300 mx-1" />
          {(['marketplace', 'reclamation', 'service_center'] as SignalSource[]).map(s => chip(q({ source: sp.source === s ? undefined : s }), SOURCE[s][lang], sp.source === s))}
        </div>
        <div className="flex flex-wrap gap-2">
          {chip(q({ status: undefined }), ru ? 'Все статусы' : 'All statuses', !sp.status)}
          {(['evidenced', 'needs_review', 'claimed', 'offered', 'recovered', 'analytics_only', 'awaiting_label', 'not_recoverable'] as CaseStatus[]).map(st => chip(q({ status: st }), CASE_STATUS[st][lang], sp.status === st))}
        </div>
      </div>
      <p className="text-[13px] text-mute mb-2">{ru ? `Найдено: ${cases.length}` : `Found: ${cases.length}`}{sp.batch ? ` · ${sp.batch}` : ''}</p>
      <Panel>
        {cases.length === 0 ? (
          <Empty>{ru ? 'Нет случаев с такими фильтрами.' : 'No cases match these filters.'}</Empty>
        ) : (
          cases.slice(0, limit).map(c => (
            <CaseRow key={c.id} c={c} lang={lang} supplierCode={supById.get(c.supplierId ?? '')?.code} batchCode={batchById.get(c.batchId ?? '')?.code} candidates={(c.candidateSupplierIds ?? []).map(id => supById.get(id)?.code ?? id)} />
          ))
        )}
      </Panel>
      {cases.length > limit && (
        <div className="mt-4 text-center"><Link href={q({ limit: String(limit + 100) })} className="underline underline-offset-2 text-[14px]">{ru ? `Показать ещё (${cases.length - limit})` : `Show more (${cases.length - limit})`}</Link></div>
      )}
    </>
  );
}
