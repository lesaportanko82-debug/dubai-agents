import type { Batch, CompensationOption, DefectCase, NegotiationPack, Supplier } from '../types.js';
import { randomUUID } from 'node:crypto';

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deterministic part of the negotiation pack: which cases, how much, defect rates,
 * compensation options and contract clauses. The model only writes the letter text.
 */
export function assemblePack(
  supplier: Supplier,
  batches: Batch[],
  cases: DefectCase[],
  period: { from: string; to: string },
): NegotiationPack | null {
  const eligible = cases.filter(
    c => c.supplierId === supplier.id && c.recoverable && c.status === 'evidenced' && c.receivedAt.slice(0, 10) >= period.from && c.receivedAt.slice(0, 10) <= period.to,
  );
  if (!eligible.length) return null;

  const amount = r2(eligible.reduce((s, c) => s + c.cost.total, 0));
  const supBatches = batches.filter(b => b.supplierId === supplier.id);
  const defectPctByBatch = supBatches
    .map(b => {
      const n = cases.filter(c => c.batchId === b.id && c.defectClass === 'manufacturing').length;
      return { batchCode: b.code, sku: b.sku, cases: n, qty: b.qty, pct: r2((100 * n) / b.qty), allowedPct: supplier.allowedDefectPct };
    })
    .filter(x => x.cases > 0);

  const avgUnit = supBatches.length ? supBatches.reduce((s, b) => s + b.unitCost, 0) / supBatches.length : 0;
  const options: CompensationOption[] = [
    { form: 'credit_note', value: amount, description: `Credit note of ${amount} ${supplier.currency} deducted from the next purchase order` },
    {
      form: 'free_parts',
      value: r2(amount * 1.15),
      description: `Free spare parts (cartridges, seals, bodies) worth ${r2(amount * 1.15)} ${supplier.currency} at factory price, loaded into the next container`,
    },
    {
      form: 'warranty_extension',
      value: r2(amount * 0.6),
      description: `Partial credit of ${r2(amount * 0.6)} ${supplier.currency} plus warranty on affected SKUs extended by 12 months`,
    },
  ];

  const worst = [...defectPctByBatch].sort((a, b) => b.pct - a.pct)[0];
  const contractClauses = [
    `Defect allowance: manufacturing defects above ${supplier.allowedDefectPct}% per batch are compensated by credit note at full landed cost per case.`,
    `Evidence standard: photo + serial number + service report is sufficient proof; supplier responds within 15 business days, otherwise the claim is accepted.`,
    `Pre-shipment inspection: AQL 1.0 for critical defects on ${worst ? worst.sku : 'affected SKUs'}, with a pressure / leak test on every carton sample.`,
    avgUnit ? `Spare-parts buffer: 2% of each order quantity shipped free of charge for warranty service.` : `Spare-parts buffer: 2% free of charge for warranty service.`,
  ];

  return {
    id: randomUUID(),
    supplierId: supplier.id,
    periodFrom: period.from,
    periodTo: period.to,
    caseIds: eligible.map(c => c.id),
    amount,
    defectPctByBatch,
    options,
    contractClauses,
    status: 'draft',
  };
}
