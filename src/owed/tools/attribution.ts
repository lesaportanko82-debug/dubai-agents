import type { Attribution, Batch } from '../types.js';

export interface AttributionResult {
  batch?: Batch;
  method: Attribution;
  candidates: number;
}

/**
 * serial → batch (exact), else SKU with a single batch, else latest batch for the SKU (a guess
 * that always requires human review), else none.
 */
export function attributeBatch(batches: Batch[], skuRaw: string, serial?: number): AttributionResult {
  const sku = normalizeSku(skuRaw);
  const bySku = batches.filter(b => normalizeSku(b.sku) === sku);

  if (serial && Number.isFinite(serial)) {
    const hit = bySku.find(b => b.serialFrom != null && b.serialTo != null && serial >= b.serialFrom && serial <= b.serialTo);
    if (hit) return { batch: hit, method: 'serial', candidates: 1 };
  }
  if (bySku.length === 1) return { batch: bySku[0], method: 'sku_single_batch', candidates: 1 };
  if (bySku.length > 1) {
    const latest = [...bySku].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt))[0];
    return { batch: latest, method: 'sku_latest_batch_guess', candidates: bySku.length };
  }
  return { method: 'none', candidates: 0 };
}

export function normalizeSku(s: string): string {
  return String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/[‐-–—]/g, '-');
}
