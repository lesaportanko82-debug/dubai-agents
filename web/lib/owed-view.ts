import { owedContext } from './owed-server';
import { assembleClaim, batchLine, deliveryStats, directDamage, funnel, riskFlags, scoreSupplier, slaOverdue, termsOf } from '@core/owed/sqpm';

/** Everything the screens show, computed once per request by the SQPM engine. */
export async function owedView() {
  const ctx = await owedContext();
  const { store, nowIso } = ctx;
  const [suppliers, contracts, batches, deliveries, cases, claims, settings] = await Promise.all([
    store.suppliers(), store.contracts(), store.batches(), store.deliveries(), store.cases(), store.claims(), store.settings(),
  ]);
  const contractOf = (supplierId: string) => contracts.find(c => c.id === suppliers.find(s => s.id === supplierId)?.contractId);
  const sorted = [...suppliers].sort((a, b) => a.code.localeCompare(b.code));
  const year = `${Number(nowIso.slice(0, 4)) - 1}${nowIso.slice(4, 10)}`;

  const rows = sorted.map(s => {
    const contract = contractOf(s.id);
    const terms = termsOf(s, contract);
    const lines = batches.filter(b => b.supplierId === s.id).map(b => ({ b, line: batchLine(b, cases, terms, contract) }));
    const direct = lines.reduce((sum, x) => sum + directDamage(x.b, x.line.cases), 0);
    // what could be claimed right now (dry run of the claim builder over the last 12 months)
    const dry = assembleClaim({ supplier: s, contract, batches, cases, deliveries, period: { from: year, to: nowIso.slice(0, 10) }, number: 'DRY', nowIso, claims });
    const mine = claims.filter(c => c.supplierId === s.id);
    const inFlight = mine.filter(c => ['sent', 'acknowledged', 'disputed', 'legal'].includes(c.status)).reduce((a, c) => a + c.amount, 0);
    const recovered = mine.filter(c => c.status === 'paid').reduce((a, c) => a + (c.paidAmount ?? 0), 0);
    const reviewCases = cases.filter(c => c.supplierId === s.id && c.status === 'needs_review');
    const score = scoreSupplier({ supplier: s, contract, batches, cases, deliveries, claims, settings, nowIso });
    const ds = deliveryStats(deliveries.filter(d => d.supplierId === s.id), terms);
    return {
      s, contract, terms, lines, direct, claimable: dry?.amount ?? 0, claimableDefects: dry?.defectAmount ?? 0, claimableDelivery: dry?.deliveryAmount ?? 0,
      inFlight, recovered, review: reviewCases.length, reviewSum: reviewCases.reduce((a, c) => a + c.cost.total, 0),
      score, ds, cases: cases.filter(c => c.supplierId === s.id).length, contractReady: (contract?.clauses ?? []).some(c => c.confirmed),
    };
  });

  const signals = cases.reduce((n, c) => n + Math.max(1, c.sources?.length ?? 1), 0);
  return {
    ...ctx,
    suppliers: sorted, contracts, batches, deliveries, cases, claims, settings, rows, contractOf,
    funnel: funnel(signals, cases),
    flags: riskFlags({ suppliers: sorted, contracts, batches, cases, deliveries, claims, nowIso }),
    overdueClaims: claims.filter(c => slaOverdue(c, nowIso)),
  };
}
