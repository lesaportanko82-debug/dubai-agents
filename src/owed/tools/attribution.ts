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
  let bySku = batches.filter(b => normalizeSku(b.sku) === sku);
  if (!bySku.length) {
    const ph = normalizeSkuPhonetic(skuRaw);
    bySku = batches.filter(b => normalizeSku(b.sku) === ph);
  }

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

// Cyrillic letters that look like Latin ones (people type "МХ-210" on a Russian keyboard)
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };
const TRANSLIT: Record<string, string> = { Л: 'L', В: 'V' }; // phonetic, used only as a fallback ("ВЛ15" → VL15)

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
