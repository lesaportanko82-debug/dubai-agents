/**
 * Synthetic 6-month history for the demo (plumbing importer, fictional factories).
 * Levels and statuses are NOT hand-set: every case goes through the same attribution
 * and decision code the agent uses.
 */
import { DEMO_BATCHES, DEMO_CONTRACTS, DEMO_DELIVERIES, DEMO_SUPPLIERS } from './fixtures';
import { attributeCase } from './tools/attribution';
import { computeCaseCost } from './tools/cost';
import { decide } from './tools/decide';
import { withinFactoryWarranty } from './tools/warranty';
import type { Batch, Claim, DefectCase, DefectClass, DefectCode, MarketplaceOrder, SignalSource } from './types';
import { DEFAULT_SETTINGS, type ScoreSettings } from './types';
import type { AuditEntry } from './store';

export interface OwedData {
  suppliers: typeof DEMO_SUPPLIERS;
  contracts: typeof DEMO_CONTRACTS;
  batches: Batch[];
  deliveries: typeof DEMO_DELIVERIES;
  orders: MarketplaceOrder[];
  cases: DefectCase[];
  claims: Claim[];
  settings: ScoreSettings;
  audit: AuditEntry[];
}

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const TEXT: Record<string, Partial<Record<DefectCode, string>>> = {
  'MX-210': { cartridge_seal: 'Cartridge leaks after a few weeks of normal use', coating: 'Chrome coating peeling off the lever', casting: 'Porous casting, pinhole leak on the body', thread: 'Inlet thread cut crooked, cannot seal' },
  'SH-120': { cartridge_seal: 'Thermostatic cartridge leaks after 4–8 weeks of normal use', valve: 'Diverter sticks, water only from the hand shower', coating: 'Chrome peeling on the shower rail' },
  'FL-30': { other: 'Braid frays near the crimp, slow drip', thread: 'Nut thread stripped on first tightening' },
  'VL-15': { valve: 'Handle turns but the ball does not close', cartridge_seal: 'Leaks at the stem from day one' },
  'TS-40': { cartridge_seal: 'Thermostat does not hold temperature, cartridge leaks' },
  'WC-07': { valve: 'Fill valve does not shut off, cistern overflows' },
};
const NOT_FACTORY: Record<'transport' | 'installation', string[]> = {
  transport: ['Box crushed in shipping, body dented', 'Broken on arrival, packaging torn'],
  installation: ['Overtightened nut cracked the body', 'No filter on well water, cartridge seized', 'Pressure above spec burst the body'],
};

export function demoData(nowIso = new Date().toISOString()): OwedData {
  const r = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const bat = (code: string) => DEMO_BATCHES.find(b => b.code === code)!;
  const day = (from: string, to: string) => new Date(Date.parse(from) + r() * (Date.parse(to) - Date.parse(from))).toISOString();
  const orders: MarketplaceOrder[] = [];
  const cases: DefectCase[] = [];
  let ref = 4400, ord = 81200, sc = 7100;

  /** One defect → one case; the same defect may arrive from 1–3 systems (dedup merges them). */
  function add(o: {
    batch?: Batch; sku?: string; cls: DefectClass; code?: DefectCode; from: string; to: string;
    how: 'serial' | 'order' | 'order_overlap' | 'nothing'; confidence?: number; text?: string;
  }) {
    const b = o.batch;
    const sku = o.sku ?? b!.sku;
    const receivedAt = day(o.from, o.to);
    let serial: number | undefined;
    let orderNo: string | undefined;
    const clientKey = `cl-${Math.floor(r() * 90000 + 10000)}`;
    if (o.how === 'serial' && b?.serialFrom != null) serial = b.serialFrom + Math.floor(r() * (b.serialTo! - b.serialFrom));
    if (o.how === 'order' || o.how === 'order_overlap') {
      orderNo = `${r() > 0.5 ? 'WB' : 'OZ'}-${ord++}`;
      // B: shipped when only this factory had stock; C: shipped inside the overlap of two factories
      const shipped = o.how === 'order_overlap' ? day('2026-08-10', '2026-08-19') : day(b!.soldOutAt ? b!.arrivedAt! : '2026-08-22', b!.soldOutAt ?? '2026-10-20');
      orders.push({ orderNo, sku, shippedAt: shipped.slice(0, 10), clientKey });
    }
    const a = attributeCase({ batches: DEMO_BATCHES, orders }, { sku, serial, orderNo });
    const sup = a.batch ? DEMO_SUPPLIERS.find(s => s.id === a.batch!.supplierId) : undefined;
    const conf = o.confidence ?? (o.cls === 'unknown' ? 0.4 : 0.8 + r() * 0.17);
    const inWarranty = a.batch && sup ? withinFactoryWarranty(a.batch, sup, receivedAt) : undefined;
    const d = decide({ defectClass: o.cls, confidence: conf, attribution: a.method, level: a.level, hasBatch: !!a.batch, withinFactoryWarranty: inWarranty });
    // sources: the first system that saw it, then possible duplicates from the others
    const first: SignalSource = orderNo ? 'marketplace' : pick(['reclamation', 'reclamation', 'service_center'] as SignalSource[]);
    const sources: DefectCase['sources'] = [{ source: first, ref: first === 'marketplace' ? `MP-${orderNo}` : first === 'service_center' ? `СЦ-${sc++}` : `A-${ref++}`, at: receivedAt }];
    const later = (h: number) => new Date(Date.parse(receivedAt) + h * 3_600_000).toISOString();
    if (r() < 0.38) sources.push({ source: 'reclamation', ref: `A-${ref++}`, at: later(20 + Math.floor(r() * 60)) });
    if (r() < 0.22) sources.push({ source: 'service_center', ref: `СЦ-${sc++}`, at: later(80 + Math.floor(r() * 200)) });
    const text = o.text ?? (o.cls === 'manufacturing' || o.cls === 'unknown'
      ? (o.cls === 'unknown' ? 'Customer says it stopped working, no details' : TEXT[sku]?.[o.code ?? 'other'] ?? 'Failure under normal use')
      : pick(NOT_FACTORY[o.cls]));
    cases.push({
      id: `c-${String(cases.length + 1).padStart(4, '0')}`,
      externalRef: sources[0].ref,
      channel: first === 'marketplace' ? 'marketplace' : first === 'service_center' ? 'service_act' : pick(['telegram', 'email']),
      receivedAt, sku, serial, orderNo, clientKey,
      batchId: a.level === 'A' || a.level === 'B' ? a.batch?.id : a.batch?.id,
      supplierId: a.level === 'A' || a.level === 'B' ? a.batch?.supplierId : undefined,
      candidateSupplierIds: a.level === 'C' ? a.candidateSupplierIds : undefined,
      attribution: a.method, level: a.level,
      description: text, defectClass: o.cls, defectCode: o.code, confidence: Math.round(conf * 100) / 100,
      reasoning: o.cls === 'manufacturing' ? 'Failure under normal use points to a production defect' : o.cls === 'transport' ? 'Damage consistent with shipping, not production' : o.cls === 'installation' ? 'Caused by installation or use outside specification' : 'Not enough information to classify',
      cost: computeCaseCost(a.batch, { compensation: r() > 0.85 ? Math.round(r() * 40) : 0 }),
      recoverable: d.recoverable, needsReview: d.needsReview, reviewReasons: d.reviewReasons, status: d.status,
      sources, photos: Math.floor(r() * 3) + (sources.length > 1 ? 1 : 0),
      labelRequestedAt: d.status === 'awaiting_label' ? later(1) : undefined,
    });
  }
  const many = (n: number, f: () => void) => { for (let i = 0; i < n; i++) f(); };

  // F-A · SH-120 · B-2026-084 — the case from the presentation: 5 000 units, 185 confirmed defects, 3.7% vs 2%
  const b084 = bat('B-2026-084');
  many(150, () => add({ batch: b084, cls: 'manufacturing', code: r() < 0.78 ? 'cartridge_seal' : pick(['valve', 'coating'] as DefectCode[]), from: '2026-08-16', to: '2026-11-12', how: 'serial' }));
  many(35, () => add({ batch: b084, cls: 'manufacturing', code: 'cartridge_seal', from: '2026-08-28', to: '2026-11-12', how: 'order' }));
  many(10, () => add({ batch: b084, cls: 'manufacturing', code: 'cartridge_seal', from: '2026-08-14', to: '2026-09-10', how: 'order_overlap' }));
  many(9, () => add({ batch: b084, cls: 'transport', from: '2026-08-12', to: '2026-11-10', how: 'serial' }));
  many(5, () => add({ batch: b084, cls: 'installation', from: '2026-08-20', to: '2026-11-10', how: 'serial' }));
  many(3, () => add({ batch: b084, cls: 'manufacturing', code: 'valve', confidence: 0.62, from: '2026-10-20', to: '2026-11-14', how: 'serial' }));

  // F-A · MX-210 · B-2026-058 — 27 confirmed of 2 000 = 1.35% vs 1% (same cartridge defect family → repeat flag)
  const b058 = bat('B-2026-058');
  many(27, () => add({ batch: b058, cls: 'manufacturing', code: r() < 0.7 ? 'cartridge_seal' : 'coating', from: '2026-07-20', to: '2026-11-10', how: 'serial' }));
  many(4, () => add({ batch: b058, cls: 'manufacturing', code: 'casting', confidence: 0.64, from: '2026-10-01', to: '2026-11-14', how: 'serial' }));
  many(7, () => add({ batch: b058, cls: pick(['transport', 'installation'] as const), from: '2026-07-20', to: '2026-11-10', how: 'serial' }));
  many(3, () => add({ batch: bat('B-2026-031'), cls: 'manufacturing', code: 'coating', from: '2026-05-01', to: '2026-07-15', how: 'serial' }));

  // F-D · SH-120 · B-2026-079 — same SKU, other factory, inside the allowance
  const b079 = bat('B-2026-079');
  many(34, () => add({ batch: b079, cls: 'manufacturing', code: pick(['valve', 'coating', 'cartridge_seal'] as DefectCode[]), from: '2026-06-10', to: '2026-11-05', how: 'serial' }));
  many(5, () => add({ batch: b079, cls: 'installation', from: '2026-06-10', to: '2026-10-30', how: 'serial' }));
  many(9, () => add({ batch: bat('B-2026-090'), cls: 'manufacturing', code: 'cartridge_seal', from: '2026-09-01', to: '2026-11-10', how: 'serial' }));

  // F-B, F-C, F-E — within the allowance
  many(8, () => add({ batch: bat('B-2026-044'), cls: 'manufacturing', code: pick(['other', 'thread'] as DefectCode[]), from: '2026-06-01', to: '2026-11-08', how: 'serial' }));
  many(7, () => add({ batch: bat('B-2026-061'), cls: 'manufacturing', code: pick(['valve', 'cartridge_seal'] as DefectCode[]), from: '2026-08-01', to: '2026-11-10', how: 'serial' }));
  many(6, () => add({ batch: bat('B-2026-061'), cls: 'installation', from: '2026-08-01', to: '2026-11-10', how: 'serial' }));
  many(5, () => add({ batch: bat('B-2026-070'), cls: 'manufacturing', code: 'valve', from: '2026-07-15', to: '2026-11-08', how: 'serial' }));

  // D — nothing to go on: no model, no serial, no order; the bot asked for a label photo
  many(6, () => add({ sku: 'не указан', cls: 'manufacturing', code: 'cartridge_seal', from: '2026-10-01', to: '2026-11-14', how: 'nothing', confidence: 0.82, text: 'Mixer leaks under the handle, model unknown, no receipt' }));

  // orders that shipped fine so far — the intake samples use them (a new B case, then its duplicate from the SC)
  orders.push(
    { orderNo: 'WB-90001', sku: 'SH-120', shippedAt: '2026-10-02', clientKey: 'cl-90001' },
    { orderNo: 'OZ-90002', sku: 'MX-210', shippedAt: '2026-09-12', clientKey: 'cl-90002' },
  );

  // earlier claims — history for the ledger, score and SLA
  const claims: Claim[] = [
    histClaim('CL-2026-006', 'sup-a', '2026-04-01', '2026-06-30', 204, [['2026-07-08', 'sent'], ['2026-07-19', 'acknowledged'], ['2026-08-02', 'paid']], 204),
    histClaim('CL-2026-008', 'sup-c', '2026-03-01', '2026-06-30', 340, [['2026-07-15', 'sent'], ['2026-07-24', 'acknowledged'], ['2026-08-10', 'paid']], 340),
    histClaim('CL-2026-009', 'sup-b', '2026-05-01', '2026-07-31', 96, [['2026-08-12', 'sent'], ['2026-08-20', 'acknowledged'], ['2026-09-01', 'paid']], 96),
    histClaim('CL-2026-010', 'sup-d', '2026-04-01', '2026-09-30', 1240, [['2026-10-22', 'sent']], undefined, 'delivery penalties for 4 late shipments'),
  ];
  // the archived penalty claim to F-D covered its first four late deliveries — never bill them twice
  claims[3].deliveryPenalties = DEMO_DELIVERIES.filter(x => x.supplierId === 'sup-d').slice(0, 4).map(x => ({ po: x.po, plannedAt: x.plannedAt, actualAt: x.actualAt!, daysLate: 0, billableDays: 0, amount: 310 }));

  const audit: AuditEntry[] = [
    { at: '2026-10-22T09:12:00Z', actor: 'buyer', action: 'claim.sent', entityId: 'cl-cl-2026-010', details: { supplier: 'F-D', amount: 1240 } },
    { at: '2026-08-02T11:40:00Z', actor: 'buyer', action: 'claim.paid', entityId: 'cl-cl-2026-006', details: { supplier: 'F-A', amount: 204 } },
  ];
  void nowIso;
  return { suppliers: DEMO_SUPPLIERS, contracts: DEMO_CONTRACTS, batches: DEMO_BATCHES, deliveries: DEMO_DELIVERIES, orders, cases, claims, settings: DEFAULT_SETTINGS, audit };
}

function histClaim(number: string, supplierId: string, from: string, to: string, amount: number, steps: [string, Claim['status']][], paid?: number, note?: string): Claim {
  const iso = (d: string) => `${d}T10:00:00.000Z`;
  const sent = steps.find(s => s[1] === 'sent')?.[0];
  const replied = steps.find(s => s[1] === 'acknowledged' || s[1] === 'disputed')?.[0];
  const paidAt = steps.find(s => s[1] === 'paid')?.[0];
  const status = steps[steps.length - 1][1];
  return {
    id: `cl-${number.toLowerCase()}`, number, supplierId, periodFrom: from, periodTo: to, currency: 'USD', caseIds: [], batches: [],
    defectAmount: note ? 0 : amount, deliveryPenalties: [], deliveryAmount: note ? amount : 0, amount, directDamage: note ? 0 : amount,
    clauseRefs: [], options: [], proposedClauses: [], evidence: { photos: 0, reclamations: 0, serviceActs: 0, marketplace: 0 },
    letters: { en: `Claim ${number} (archived).`, source: 'template' }, status, createdAt: iso(steps[0][0]),
    reviewedBy: 'buyer', sentAt: sent ? iso(sent) : undefined, dueAt: sent ? new Date(Date.parse(iso(sent)) + 15 * 86_400_000).toISOString() : undefined,
    repliedAt: replied ? iso(replied) : undefined, paidAmount: paid, paidAt: paidAt ? iso(paidAt) : undefined,
    history: [{ at: iso(steps[0][0]), status: 'draft', role: 'agent', note: note ?? 'archived claim' }, ...steps.map(([d, st]) => ({ at: iso(d), status: st, role: 'buyer' as const }))],
  };
}
