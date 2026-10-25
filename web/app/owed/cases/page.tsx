import Link from 'next/link';
import { owedState } from '@/lib/owed-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Empty } from '@/components/ui';
import { CaseRow, STATUS_LABEL } from '@/components/owed/CaseRow';

export const dynamic = 'force-dynamic';

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ supplier?: string; status?: string }> }) {
  const lang = await getLang();
  const ru = lang === 'ru';
  const { supplier, status } = await searchParams;
  const { store } = owedState();
  const [suppliers, batches, all] = await Promise.all([store.suppliers(), store.batches(), store.cases()]);
  const supById = new Map(suppliers.map(s => [s.id, s]));
  const batchById = new Map(batches.map(b => [b.id, b]));

  let cases = [...all].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  if (supplier) cases = cases.filter(c => supById.get(c.supplierId ?? '')?.code === supplier);
  if (status) cases = cases.filter(c => c.status === status);

  const statuses = ['evidenced', 'needs_review', 'claimed', 'recovered', 'not_recoverable'];
  const chip = (href: string, label: string, active: boolean) => (
    <Link key={href} href={href} className={`rounded-full px-3 py-1 text-[13px] border ${active ? 'accent-bg text-white border-transparent' : 'border-stone-300 bg-paper hover:border-stone-400'}`}>{label}</Link>
  );

  return (
    <>
      <PageTitle title={ru ? 'Случаи' : 'Cases'} lead={ru ? 'Каждая рекламация после разбора агентом: класс дефекта, партия, стоимость и куда она пошла.' : 'Every complaint after the agent’s analysis: defect class, batch, cost and where it went.'} />
      <div className="flex flex-wrap gap-2 mb-4">
        {chip('/owed/cases', ru ? 'Все заводы' : 'All factories', !supplier && !status)}
        {suppliers.map(s => chip(`/owed/cases?supplier=${s.code}`, s.code, supplier === s.code))}
        <span className="w-px bg-stone-300 mx-1" />
        {statuses.map(st => chip(`/owed/cases?status=${st}${supplier ? `&supplier=${supplier}` : ''}`, STATUS_LABEL[st][lang], status === st))}
      </div>
      <Panel>
        {cases.length === 0 ? (
          <Empty>{ru ? 'Нет случаев с такими фильтрами.' : 'No cases match these filters.'}</Empty>
        ) : (
          cases.map(c => <CaseRow key={c.id} c={c} lang={lang} supplierCode={supById.get(c.supplierId ?? '')?.code} batchCode={batchById.get(c.batchId ?? '')?.code} />)
        )}
      </Panel>
    </>
  );
}
