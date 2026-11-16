import type { Attribution, AttributionLevel, Batch, MarketplaceOrder } from '../types';

export interface AttributionResult {
  batch?: Batch;
  method: Attribution;
  candidates: number;
}

/**
 * Legacy single-signal attribution (serial → batch, single-batch SKU, else latest batch guess).
 * Kept for the agent's quick lookup; `attributeCase` is the full A–D ladder.
 */
export function attributeBatch(batches: Batch[], skuRaw: string, serial?: number): AttributionResult {
  const bySku = batchesForSku(batches, skuRaw);
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

export function levelOf(method: Attribution): AttributionLevel {
  switch (method) {
    case 'serial': case 'label': return 'A';
    case 'order_stock': case 'sku_single_batch': case 'manual': return 'B';
    case 'sku_latest_batch_guess': return 'C';
    default: return 'D';
  }
}

/** Only these levels may ever reach a claim to a factory (and only after a person checks the claim). */
export const CLAIMABLE_LEVELS: AttributionLevel[] = ['A', 'B'];

export interface CaseAttribution {
  batch?: Batch;
  method: Attribution;
  level: AttributionLevel;
  candidateBatches: Batch[];
  candidateSupplierIds: string[];
  why: string;
}

/**
 * The A–D ladder from the SQPM design:
 *  A — serial number / batch code on the label → the exact batch
 *  B — marketplace order → ship date → batches that were in stock that day → one factory (FIFO batch);
 *      or the SKU has a single batch
 *  C — several factories possible: a guess by features, analytics only
 *  D — nothing to go on: ask the customer for a photo of the label
 */
export function attributeCase(
  ctx: { batches: Batch[]; orders?: MarketplaceOrder[] },
  q: { sku: string; serial?: number; labelBatchCode?: string; orderNo?: string },
): CaseAttribution {
  const bySku = batchesForSku(ctx.batches, q.sku);
  const sup = (bs: Batch[]) => Array.from(new Set(bs.map(b => b.supplierId)));

  if (q.labelBatchCode) {
    const code = q.labelBatchCode.trim().toUpperCase();
    const hit = ctx.batches.find(b => b.code.toUpperCase() === code || b.code.toUpperCase().endsWith(code));
    if (hit) return { batch: hit, method: 'label', level: 'A', candidateBatches: [hit], candidateSupplierIds: [hit.supplierId], why: `batch code ${hit.code} read from the label` };
  }
  if (q.serial && Number.isFinite(q.serial)) {
    const hit = bySku.find(b => b.serialFrom != null && b.serialTo != null && q.serial! >= b.serialFrom && q.serial! <= b.serialTo);
    if (hit) return { batch: hit, method: 'serial', level: 'A', candidateBatches: [hit], candidateSupplierIds: [hit.supplierId], why: `serial ${q.serial} is inside ${hit.code}` };
  }
  if (q.orderNo && ctx.orders) {
    const order = ctx.orders.find(o => o.orderNo.toUpperCase() === q.orderNo!.toUpperCase());
    if (order) {
      const day = order.shippedAt.slice(0, 10);
      const inStock = bySku
        .filter(b => (b.arrivedAt ?? b.shippedAt) <= day && (!b.soldOutAt || b.soldOutAt >= day))
        .sort((a, b) => (a.arrivedAt ?? a.shippedAt).localeCompare(b.arrivedAt ?? b.shippedAt));
      const factories = sup(inStock);
      if (inStock.length && factories.length === 1) {
        // FIFO: the oldest batch still in stock was the one that shipped
        return { batch: inStock[0], method: 'order_stock', level: 'B', candidateBatches: inStock, candidateSupplierIds: factories, why: `order shipped ${day}; one factory had stock that day (${inStock.map(b => b.code).join(', ')}), FIFO → ${inStock[0].code}` };
      }
      if (inStock.length > 1) {
        const latest = inStock[inStock.length - 1];
        return { batch: latest, method: 'sku_latest_batch_guess', level: 'C', candidateBatches: inStock, candidateSupplierIds: factories, why: `order shipped ${day}; ${factories.length} factories had stock that day — analytics only` };
      }
    }
  }
  if (bySku.length === 1) {
    return { batch: bySku[0], method: 'sku_single_batch', level: 'B', candidateBatches: bySku, candidateSupplierIds: [bySku[0].supplierId], why: `the SKU has a single batch ${bySku[0].code}` };
  }
  if (bySku.length > 1) {
    const latest = [...bySku].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt))[0];
    return { batch: latest, method: 'sku_latest_batch_guess', level: 'C', candidateBatches: bySku, candidateSupplierIds: sup(bySku), why: `${bySku.length} batches of this SKU, no serial/order — a guess, analytics only` };
  }
  return { method: 'none', level: 'D', candidateBatches: [], candidateSupplierIds: [], why: 'SKU not found in purchases' };
}

export function batchesForSku(batches: Batch[], skuRaw: string): Batch[] {
  const sku = normalizeSku(skuRaw);
  let bySku = batches.filter(b => normalizeSku(b.sku) === sku);
  if (!bySku.length) {
    const ph = normalizeSkuPhonetic(skuRaw);
    bySku = batches.filter(b => normalizeSku(b.sku) === ph);
  }
  return bySku;
}

// Cyrillic letters that look like Latin ones (people type "МХ-210" on a Russian keyboard)
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };
const TRANSLIT: Record<string, string> = { Л: 'L', В: 'V', Ш: 'SH', Ф: 'F', Ч: 'CH' }; // phonetic, fallback only ("ВЛ15" → VL15)

export function normalizeSku(s: string): string {
  const up = String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/[‐-–—_]/g, '-');
  const latin = [...up].map(ch => LOOKALIKE[ch] ?? ch).join('');
  return latin.replace(/^([A-Z]+)-?(\d+)$/, '$1-$2'); // MX210 → MX-210
}

/** Phonetic fallback: "вл15" → "VL-15" */
export function normalizeSkuPhonetic(s: string): string {
  const up = String(s ?? '').toUpperCase().replace(/\s+/g, '').replace(/[‐-–—_]/g, '-');
  const latin = [...up].map(ch => TRANSLIT[ch] ?? LOOKALIKE[ch] ?? ch).join('');
  return latin.replace(/^([A-Z]+)-?(\d+)$/, '$1-$2');
}
