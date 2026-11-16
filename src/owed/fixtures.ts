import type { Batch, Contract, ContractClause, Delivery, Supplier } from './types';

/**
 * Synthetic demo data — fictional factories, products and contracts (plumbing).
 * Never real customer or supplier data.
 */
export const DEMO_SUPPLIERS: Supplier[] = [
  { id: 'sup-a', code: 'F-A', name: 'Ningbo Brightflow Sanitary Co. (demo)', city: 'Ningbo', contactLang: 'zh', warrantyMonths: 24, allowedDefectPct: 1.0, currency: 'USD', contractId: 'ct-a' },
  { id: 'sup-b', code: 'F-B', name: 'Foshan Kaiyuan Hose Works (demo)', city: 'Foshan', contactLang: 'zh', warrantyMonths: 18, allowedDefectPct: 1.5, currency: 'USD', contractId: 'ct-b' },
  { id: 'sup-c', code: 'F-C', name: 'Taizhou Aqualine Valves (demo)', city: 'Taizhou', contactLang: 'en', warrantyMonths: 12, allowedDefectPct: 2.0, currency: 'USD', contractId: 'ct-c' },
  { id: 'sup-d', code: 'F-D', name: 'Jiangmen Hydro Bath Fittings (demo)', city: 'Jiangmen', contactLang: 'zh', warrantyMonths: 24, allowedDefectPct: 2.0, currency: 'USD', contractId: 'ct-d' },
  { id: 'sup-e', code: 'F-E', name: 'Xiamen Clearwater Fittings (demo)', city: 'Xiamen', contactLang: 'en', warrantyMonths: 18, allowedDefectPct: 1.5, currency: 'USD', contractId: 'ct-e' },
];

export const PRODUCTS: Record<string, { ru: string; en: string }> = {
  'MX-210': { ru: 'смеситель для кухни', en: 'kitchen faucet' },
  'SH-120': { ru: 'душевая система с термостатом', en: 'thermostatic shower system' },
  'FL-30': { ru: 'гибкая подводка 60 см', en: 'braided hose 60 cm' },
  'VL-15': { ru: 'шаровой кран ½″', en: 'ball valve ½″' },
  'TS-40': { ru: 'термостатический смеситель', en: 'thermostatic mixer' },
  'WC-07': { ru: 'арматура для бачка унитаза', en: 'cistern fill & flush valve set' },
};

export const DEMO_BATCHES: Batch[] = [
  { id: 'bat-031', code: 'B-2026-031', supplierId: 'sup-a', sku: 'MX-210', product: 'kitchen faucet', container: 'MSKU4410021', serialFrom: 100000, serialTo: 101999, shippedAt: '2026-03-12', arrivedAt: '2026-04-15', soldOutAt: '2026-07-20', qty: 2000, soldUnits: 2000, unitCost: 18.5, deliveryId: 'dl-a2' },
  { id: 'bat-058', code: 'B-2026-058', supplierId: 'sup-a', sku: 'MX-210', product: 'kitchen faucet', container: 'MSKU4410387', serialFrom: 102000, serialTo: 103999, shippedAt: '2026-06-02', arrivedAt: '2026-07-10', qty: 2000, soldUnits: 2000, unitCost: 18.2, deliveryId: 'dl-a5' },
  { id: 'bat-084', code: 'B-2026-084', supplierId: 'sup-a', sku: 'SH-120', product: 'thermostatic shower system', container: 'MSKU4410552', serialFrom: 300000, serialTo: 304999, shippedAt: '2026-07-14', arrivedAt: '2026-08-09', qty: 5000, soldUnits: 5000, unitCost: 18.0, deliveryId: 'dl-a6' },
  { id: 'bat-044', code: 'B-2026-044', supplierId: 'sup-b', sku: 'FL-30', product: 'braided hose', container: 'CMAU7781204', serialFrom: 500000, serialTo: 509999, shippedAt: '2026-04-20', arrivedAt: '2026-05-18', qty: 10000, soldUnits: 6400, unitCost: 2.4, deliveryId: 'dl-b2' },
  { id: 'bat-061', code: 'B-2026-061', supplierId: 'sup-c', sku: 'VL-15', product: 'ball valve', container: 'OOLU2290318', serialFrom: 900000, serialTo: 904999, shippedAt: '2026-06-28', arrivedAt: '2026-07-24', qty: 5000, soldUnits: 3800, unitCost: 3.1, deliveryId: 'dl-c3' },
  { id: 'bat-079', code: 'B-2026-079', supplierId: 'sup-d', sku: 'SH-120', product: 'thermostatic shower system', container: 'TGHU6631840', serialFrom: 600000, serialTo: 602999, shippedAt: '2026-04-28', arrivedAt: '2026-05-25', soldOutAt: '2026-08-20', qty: 3000, soldUnits: 3000, unitCost: 17.6, deliveryId: 'dl-d2' },
  { id: 'bat-090', code: 'B-2026-090', supplierId: 'sup-d', sku: 'TS-40', product: 'thermostatic mixer', container: 'TGHU6632077', serialFrom: 610000, serialTo: 611499, shippedAt: '2026-07-15', arrivedAt: '2026-08-21', qty: 1500, soldUnits: 1100, unitCost: 26.0, deliveryId: 'dl-d4' },
  { id: 'bat-070', code: 'B-2026-070', supplierId: 'sup-e', sku: 'WC-07', product: 'cistern valve set', container: 'EGLV5510734', serialFrom: 700000, serialTo: 703999, shippedAt: '2026-06-10', arrivedAt: '2026-07-02', qty: 4000, soldUnits: 2900, unitCost: 4.2, deliveryId: 'dl-e3' },
];

/* ---------------- contracts (synthetic) ---------------- */

interface ContractSpec {
  id: string; supplierId: string; number: string; signedAt: string; seller: string;
  warranty: number; allowance: number; skuAllowance?: { sku: string; pct: number; clause: string };
  basis: 'all_cases' | 'excess_only'; grace: number; penalty: number; cap: number; reply: number;
  extracted: boolean;
}

function contract(spec: ContractSpec): Contract {
  const q = {
    warranty: `The Seller guarantees the Goods for ${spec.warranty} months from the date of shipment.`,
    allowance: `The allowable rate of manufacturing defects is ${spec.allowance}% of the units of each batch.`,
    sku: spec.skuAllowance ? `For ${spec.skuAllowance.clause} ${spec.skuAllowance.sku} the allowable rate of manufacturing defects is ${spec.skuAllowance.pct}% of the units of each batch.` : '',
    basis: spec.basis === 'all_cases'
      ? 'Where the defect rate of a batch exceeds the allowable rate, the Seller compensates every confirmed defective unit of that batch at landed cost, including logistics and service costs.'
      : 'Where the defect rate of a batch exceeds the allowable rate, the Seller compensates the defective units in excess of the allowable rate at landed cost, including logistics and service costs.',
    evidence: 'A photo of the defect, the serial or batch number and a service report are sufficient evidence of a defect.',
    grace: `Delivery dates are fixed in each Purchase Order. A delay of up to ${spec.grace} days is tolerated.`,
    penalty: `For each day of delay beyond the tolerance the Seller pays a penalty of ${spec.penalty}% of the value of the delayed shipment.`,
    cap: `The total delay penalty shall not exceed ${spec.cap}% of the value of the shipment.`,
    reply: `The Seller shall reply to a claim within ${spec.reply} days of receipt; a claim without a reply is deemed accepted.`,
  };
  const n = spec.skuAllowance ? 1 : 0;
  const text = [
    `SUPPLY AGREEMENT No. ${spec.number}`,
    `Signed on ${spec.signedAt} between ${spec.seller} (the "Seller") and the Buyer (demo importer).`,
    `1. SUBJECT`,
    `1.1 The Seller supplies sanitary ware and plumbing fittings (the "Goods") in batches under Purchase Orders.`,
    `4. MARKING`,
    `4.1 Each unit carries a serial number; the batch number is printed on the carton.`,
    `5. QUALITY AND WARRANTY`,
    `5.1 ${q.warranty}`,
    `5.2 ${q.allowance}`,
    ...(spec.skuAllowance ? [`5.3 ${q.sku}`] : []),
    `5.${3 + n} ${q.basis}`,
    `5.${4 + n} ${q.evidence}`,
    `6. DELIVERY`,
    `6.1 ${q.grace}`,
    `6.2 ${q.penalty}`,
    `6.3 ${q.cap}`,
    `7. CLAIMS`,
    `7.1 ${q.reply}`,
    `7.2 Disputes are settled by negotiation; failing that, by arbitration in Hong Kong.`,
  ].join('\n');

  const by = spec.extracted ? 'seed' as const : 'seed' as const;
  const clauses: ContractClause[] = spec.extracted ? [
    { topic: 'warranty_months', ref: '5.1', quote: q.warranty, value: spec.warranty, confirmed: true, extractedBy: by },
    { topic: 'defect_allowance_pct', ref: '5.2', quote: q.allowance, value: spec.allowance, confirmed: true, extractedBy: by },
    ...(spec.skuAllowance ? [{ topic: 'defect_allowance_pct' as const, ref: '5.3', quote: q.sku, value: spec.skuAllowance.pct, sku: spec.skuAllowance.sku, confirmed: true, extractedBy: by }] : []),
    { topic: 'compensation_basis', ref: `5.${3 + n}`, quote: q.basis, basis: spec.basis, confirmed: true, extractedBy: by },
    { topic: 'evidence_standard', ref: `5.${4 + n}`, quote: q.evidence, confirmed: true, extractedBy: by },
    { topic: 'delivery_grace_days', ref: '6.1', quote: q.grace, value: spec.grace, confirmed: true, extractedBy: by },
    { topic: 'delivery_penalty_pct_day', ref: '6.2', quote: q.penalty, value: spec.penalty, confirmed: true, extractedBy: by },
    { topic: 'delivery_penalty_cap_pct', ref: '6.3', quote: q.cap, value: spec.cap, confirmed: true, extractedBy: by },
    { topic: 'claim_response_days', ref: '7.1', quote: q.reply, value: spec.reply, confirmed: true, extractedBy: by },
  ] : [];
  return { id: spec.id, supplierId: spec.supplierId, number: spec.number, signedAt: spec.signedAt, text, clauses };
}

export const DEMO_CONTRACTS: Contract[] = [
  contract({ id: 'ct-a', supplierId: 'sup-a', number: 'NB-2025-114', signedAt: '2025-11-03', seller: 'Ningbo Brightflow Sanitary Co.', warranty: 24, allowance: 1, skuAllowance: { sku: 'SH-120', pct: 2, clause: 'shower systems' }, basis: 'all_cases', grace: 5, penalty: 0.1, cap: 5, reply: 15, extracted: true }),
  contract({ id: 'ct-b', supplierId: 'sup-b', number: 'FS-2025-071', signedAt: '2025-09-18', seller: 'Foshan Kaiyuan Hose Works', warranty: 18, allowance: 1.5, basis: 'excess_only', grace: 7, penalty: 0.05, cap: 3, reply: 20, extracted: true }),
  contract({ id: 'ct-c', supplierId: 'sup-c', number: 'TZ-2026-009', signedAt: '2026-01-22', seller: 'Taizhou Aqualine Valves', warranty: 12, allowance: 2, basis: 'excess_only', grace: 7, penalty: 0.05, cap: 3, reply: 15, extracted: true }),
  contract({ id: 'ct-d', supplierId: 'sup-d', number: 'JM-2026-002', signedAt: '2026-02-10', seller: 'Jiangmen Hydro Bath Fittings', warranty: 24, allowance: 2, basis: 'all_cases', grace: 5, penalty: 0.1, cap: 5, reply: 15, extracted: true }),
  // F-E: a new contract nobody has analysed yet — the agent extracts its terms, a person confirms them
  contract({ id: 'ct-e', supplierId: 'sup-e', number: 'XM-2026-031', signedAt: '2026-05-14', seller: 'Xiamen Clearwater Fittings', warranty: 18, allowance: 1.5, basis: 'excess_only', grace: 3, penalty: 0.1, cap: 5, reply: 10, extracted: false }),
];

/* ---------------- deliveries (contract date vs actual) ---------------- */

function deliveries(supplierId: string, prefix: string, rows: [string, number, number, number | null][]): Delivery[] {
  // [plannedAt, amount, confirmedShiftDays, actualDelayDays|null]
  const add = (iso: string, d: number) => new Date(Date.parse(iso) + d * 86_400_000).toISOString().slice(0, 10);
  return rows.map(([planned, amount, conf, delay], i) => ({
    id: `dl-${prefix}${i + 1}`, supplierId, po: `PO-${prefix.toUpperCase()}-${String(2600 + i * 7 + prefix.charCodeAt(0) % 5)}`,
    amount, currency: 'USD', plannedAt: planned, confirmedAt: add(planned, conf), actualAt: delay == null ? undefined : add(planned, delay),
  }));
}

export const DEMO_DELIVERIES: Delivery[] = [
  ...deliveries('sup-a', 'a', [
    ['2026-03-05', 21400, 0, 0], ['2026-04-10', 37000, 0, 0], ['2026-05-02', 18300, 0, 3], ['2026-05-28', 22800, 2, 0],
    ['2026-06-20', 36400, 5, 20], ['2026-07-18', 90000, 7, 22], ['2026-08-22', 26600, 10, 25], ['2026-09-19', 31200, 14, 27], ['2026-10-17', 18400, 14, 32],
    ['2026-11-28', 41000, 10, null],
  ]),
  ...deliveries('sup-b', 'b', [
    ['2026-04-01', 9800, 0, 0], ['2026-05-12', 24000, 0, 3], ['2026-06-09', 8200, 0, 2], ['2026-07-14', 11300, 3, 5], ['2026-08-25', 9100, 2, 4], ['2026-10-06', 12700, 2, 4],
  ]),
  ...deliveries('sup-c', 'c', [
    ['2026-05-05', 7400, 3, 5], ['2026-06-12', 6200, 4, 6], ['2026-07-17', 15500, 5, 7], ['2026-09-03', 8800, 4, 6],
  ]),
  ...deliveries('sup-d', 'd', [
    ['2026-04-02', 14200, 5, 12], ['2026-05-08', 52800, 7, 17], ['2026-06-19', 16900, 10, 21], ['2026-08-01', 39000, 14, 25], ['2026-09-26', 21700, 18, 30],
  ]),
  ...deliveries('sup-e', 'e', [
    ['2026-04-22', 6600, 0, 2], ['2026-05-30', 7100, 0, 1], ['2026-06-24', 16800, 2, 3], ['2026-09-10', 9900, 0, 2],
  ]),
];
