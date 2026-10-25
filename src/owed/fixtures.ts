import type { Batch, Supplier } from './types.js';

/** Synthetic demo data — fictional factories and products. Never real customer data. */
export const DEMO_SUPPLIERS: Supplier[] = [
  { id: 'sup-a', code: 'F-A', name: 'Ningbo Brightflow Sanitary Co. (demo)', contactLang: 'zh', warrantyMonths: 24, allowedDefectPct: 1.0, currency: 'USD' },
  { id: 'sup-b', code: 'F-B', name: 'Foshan Kaiyuan Faucet Works (demo)', contactLang: 'zh', warrantyMonths: 18, allowedDefectPct: 1.5, currency: 'USD' },
  { id: 'sup-c', code: 'F-C', name: 'Taizhou Aqualine Valves (demo)', contactLang: 'en', warrantyMonths: 12, allowedDefectPct: 2.0, currency: 'USD' },
];

export const DEMO_BATCHES: Batch[] = [
  { id: 'bat-031', code: 'B-2026-031', supplierId: 'sup-a', sku: 'MX-210', container: 'MSKU4410021', serialFrom: 100000, serialTo: 101999, shippedAt: '2026-03-12', qty: 2000, unitCost: 18.5 },
  { id: 'bat-058', code: 'B-2026-058', supplierId: 'sup-a', sku: 'MX-210', container: 'MSKU4410387', serialFrom: 102000, serialTo: 103999, shippedAt: '2026-06-02', qty: 2000, unitCost: 18.2 },
  { id: 'bat-044', code: 'B-2026-044', supplierId: 'sup-b', sku: 'KT-550', container: 'CMAU7781204', serialFrom: 500000, serialTo: 501499, shippedAt: '2026-04-20', qty: 1500, unitCost: 24.0 },
  { id: 'bat-061', code: 'B-2026-061', supplierId: 'sup-c', sku: 'VL-15', container: 'OOLU2290318', serialFrom: 900000, serialTo: 904999, shippedAt: '2026-06-28', qty: 5000, unitCost: 3.1 },
];
