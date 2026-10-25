import type { Batch, DefectCase, Supplier } from '../types';

export interface BatchRate {
  batch: Batch;
  supplier: Supplier;
  manufacturingCases: number;
  pct: number;
  allowedPct: number;
  /** Ratio of this batch's rate to the median rate of the same SKU's other batches (null if none). */
  vsSkuBaseline: number | null;
  alert: boolean;
  alertReason?: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Flags a batch when its manufacturing-defect rate exceeds the contract allowance
 * or is at least `spikeFactor` times the SKU baseline.
 */
export function detectSpikes(batches: Batch[], suppliers: Supplier[], cases: DefectCase[], spikeFactor = 2): BatchRate[] {
  const supById = new Map(suppliers.map(s => [s.id, s]));
  const rates = batches.map(b => {
    const n = cases.filter(c => c.batchId === b.id && c.defectClass === 'manufacturing').length;
    return { b, n, pct: (100 * n) / b.qty };
  });

  return rates.map(({ b, n, pct }) => {
    const supplier = supById.get(b.supplierId)!;
    const others = rates.filter(r => r.b.sku === b.sku && r.b.id !== b.id).map(r => r.pct).sort((x, y) => x - y);
    const median = others.length ? others[Math.floor(others.length / 2)] : null;
    const vs = median && median > 0 ? pct / median : null;

    let alert = false;
    let alertReason: string | undefined;
    if (pct > supplier.allowedDefectPct) {
      alert = true;
      alertReason = `rate ${r3(pct)}% above contract allowance ${supplier.allowedDefectPct}%`;
    } else if (vs !== null && vs >= spikeFactor && n >= 3) {
      alert = true;
      alertReason = `rate ${vs.toFixed(1)}× the SKU baseline`;
    }
    return { batch: b, supplier, manufacturingCases: n, pct: r3(pct), allowedPct: supplier.allowedDefectPct, vsSkuBaseline: vs === null ? null : r3(vs), alert, alertReason };
  });
}
