/**
 * SQPM engine — every number the platform shows is computed here, deterministically.
 * The model classifies text and writes letters; it never decides money, levels or dates.
 */
import type {
  Batch, BatchDefectLine, Claim, ClaimStatus, ClauseTopic, CompensationOption, Contract, ContractClause, ContractTerms,
  DefectCase, Delivery, DeliveryPenaltyLine, Role, ScoreSettings, Signal, Supplier,
} from './types';
import { DEFAULT_SETTINGS } from './types';
import { normalizeSku } from './tools/attribution';

const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/* ============================== contract terms ============================== */

/** Terms come from the confirmed contract clauses; anything missing falls back to the supplier card. */
export function termsOf(supplier: Supplier, contract?: Contract): ContractTerms {
  const t: ContractTerms = {
    warrantyMonths: supplier.warrantyMonths,
    allowedDefectPct: supplier.allowedDefectPct,
    allowedDefectPctBySku: {},
    compensationBasis: 'all_cases',
    includeLogistics: true,
    includeService: true,
    deliveryGraceDays: 0,
    deliveryPenaltyPctPerDay: 0,
    deliveryPenaltyCapPct: 10,
    claimResponseDays: 15,
  };
  for (const c of contract?.clauses ?? []) {
    if (!c.confirmed) continue;
    switch (c.topic) {
      case 'warranty_months': if (c.value != null) t.warrantyMonths = c.value; break;
      case 'defect_allowance_pct':
        if (c.value == null) break;
        if (c.sku) t.allowedDefectPctBySku[normalizeSku(c.sku)] = c.value; else t.allowedDefectPct = c.value;
        break;
      case 'compensation_basis': if (c.basis) t.compensationBasis = c.basis; break;
      case 'delivery_grace_days': if (c.value != null) t.deliveryGraceDays = c.value; break;
      case 'delivery_penalty_pct_day': if (c.value != null) t.deliveryPenaltyPctPerDay = c.value; break;
      case 'delivery_penalty_cap_pct': if (c.value != null) t.deliveryPenaltyCapPct = c.value; break;
      case 'claim_response_days': if (c.value != null) t.claimResponseDays = c.value; break;
    }
  }
  return t;
}

export function allowanceFor(t: ContractTerms, sku: string): number {
  return t.allowedDefectPctBySku[normalizeSku(sku)] ?? t.allowedDefectPct;
}

export function clauseFor(contract: Contract | undefined, topic: ClauseTopic, sku?: string): ContractClause | undefined {
  const cs = (contract?.clauses ?? []).filter(c => c.topic === topic && c.confirmed);
  return (sku ? cs.find(c => c.sku && normalizeSku(c.sku) === normalizeSku(sku)) : undefined) ?? cs.find(c => !c.sku);
}

/**
 * Guard for AI contract analysis: a clause is accepted only if its quote is in the contract
 * word for word, its reference appears in the contract, and its number appears in the quote.
 */
export function verifyClause(contractText: string, c: { ref: string; quote: string; value?: number }): { ok: boolean; reason?: string } {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const text = norm(contractText);
  const quote = norm(c.quote);
  if (quote.length < 12) return { ok: false, reason: 'quote too short' };
  if (!text.includes(quote)) return { ok: false, reason: 'quote not found in the contract' };
  if (!new RegExp(`(^|\\s|\\b)${c.ref.replace(/\./g, '\\.')}(\\.|\\s|\\b)`).test(text)) return { ok: false, reason: `clause ${c.ref} not found` };
  if (c.value != null) {
    const nums = (quote.match(/\d+(?:[.,]\d+)?/g) ?? []).map(x => Number(x.replace(',', '.')));
    if (!nums.includes(c.value)) return { ok: false, reason: `value ${c.value} is not in the quoted clause` };
  }
  return { ok: true };
}

/* ============================== deduplication ============================== */

/** One defect seen in a review, a reclamation and a service act is ONE case. Key: order + SKU + client + date window. */
export function findDuplicate(
  cases: DefectCase[],
  q: { sku: string; orderNo?: string; clientKey?: string; serial?: number; receivedAt: string; externalRef?: string; channel?: string },
  windowDays = DEFAULT_SETTINGS.dedupWindowDays,
): { case: DefectCase; by: 'ref' | 'order_key' | 'serial' } | undefined {
  if (q.externalRef) {
    const byRef = cases.find(c => c.externalRef === q.externalRef && (!q.channel || c.channel === q.channel || (c.sources ?? []).some(s => s.ref === q.externalRef)));
    if (byRef) return { case: byRef, by: 'ref' };
  }
  const sku = normalizeSku(q.sku);
  const near = (c: DefectCase) => Math.abs(Date.parse(c.receivedAt) - Date.parse(q.receivedAt)) <= windowDays * DAY;
  if (q.orderNo) {
    const hit = cases.find(c => c.orderNo && c.orderNo === q.orderNo && normalizeSku(c.sku) === sku && (!q.clientKey || !c.clientKey || c.clientKey === q.clientKey) && near(c));
    if (hit) return { case: hit, by: 'order_key' };
  }
  if (q.serial) {
    const hit = cases.find(c => c.serial === q.serial && normalizeSku(c.sku) === sku);
    if (hit) return { case: hit, by: 'serial' };
  }
  return undefined;
}

/** Funnel from raw messages to claimable cases (slide: 120 → 92 → 78 → 64). */
export function funnel(signals: Signal[] | number, cases: DefectCase[]) {
  const unique = cases.length;
  const confirmed = cases.filter(c => c.defectClass === 'manufacturing' && c.status !== 'needs_review').length;
  const ab = cases.filter(c => c.defectClass === 'manufacturing' && c.status !== 'needs_review' && (c.level === 'A' || c.level === 'B')).length;
  const raw = typeof signals === 'number' ? signals : signals.length;
  const viaSources = cases.reduce((n, c) => n + Math.max(1, c.sources?.length ?? 1), 0);
  return { total: Math.max(raw, viaSources, unique), unique, confirmed, ab };
}

/* ============================== defect rates & damage ============================== */

/** A confirmed defect: manufacturing, attributed A/B, checked (not waiting for review), not withdrawn. */
export const isConfirmed = (c: DefectCase) =>
  c.defectClass === 'manufacturing' && (c.level === 'A' || c.level === 'B') && !['needs_review', 'written_off', 'not_recoverable'].includes(c.status);

/** Defect rate = confirmed defects / units SOLD from the batch — not the number of complaints. */
export function batchLine(batch: Batch, cases: DefectCase[], terms: ContractTerms, contract?: Contract): BatchDefectLine & { cases_: DefectCase[] } {
  const cs = cases.filter(c => c.batchId === batch.id && isConfirmed(c));
  const base = batch.soldUnits ?? batch.qty;
  const pct = base ? r2((100 * cs.length) / base) : 0;
  const allowedPct = allowanceFor(terms, batch.sku);
  const over = pct > allowedPct;
  const allowedCases = Math.floor((allowedPct / 100) * base);
  const compensatedCases = !over ? 0 : terms.compensationBasis === 'all_cases' ? cs.length : Math.max(0, cs.length - allowedCases);
  const clause = clauseFor(contract, 'defect_allowance_pct', batch.sku);
  return {
    batchCode: batch.code, sku: batch.sku, cases: cs.length, qty: batch.qty, soldUnits: base, pct, allowedPct,
    overAllowance: over, compensatedCases, amount: 0, clauseRef: clause?.ref, cases_: cs,
  };
}

/** Per-case cost that the contract allows to claim: unit cost (+ logistics, + service work). */
export function claimableCaseCost(batch: Batch, c: DefectCase, t: ContractTerms): number {
  return r2(batch.unitCost + (t.includeLogistics ? c.cost.logistics : 0) + (t.includeService ? c.cost.labour : 0));
}

/** Direct damage, before the contract: every confirmed defect × unit cost. */
export function directDamage(batch: Batch, confirmedCases: number) {
  return r2(confirmedCases * batch.unitCost);
}

/* ============================== delivery discipline ============================== */

export interface DeliveryRow {
  d: Delivery;
  daysLate: number | null;   // vs contract date; null = still in transit
  bucket: 'on_time' | 'late_7' | 'late_more' | 'transit';
  penalty: number;
  billableDays: number;
}

export function deliveryStats(deliveries: Delivery[], terms: ContractTerms, sinceIso?: string) {
  const ds = deliveries
    .filter(d => !sinceIso || d.plannedAt >= sinceIso.slice(0, 10))
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
  const rows: DeliveryRow[] = ds.map(d => {
    if (!d.actualAt) return { d, daysLate: null, bucket: 'transit', penalty: 0, billableDays: 0 };
    const late = Math.max(0, days(d.plannedAt, d.actualAt));
    const billable = Math.max(0, late - terms.deliveryGraceDays);
    const raw = (d.amount * terms.deliveryPenaltyPctPerDay * billable) / 100;
    const cap = (d.amount * terms.deliveryPenaltyCapPct) / 100;
    return { d, daysLate: late, bucket: late <= terms.deliveryGraceDays ? 'on_time' : late <= 7 ? 'late_7' : 'late_more', penalty: r2(Math.min(raw, cap)), billableDays: billable };
  });
  const done = rows.filter(r => r.daysLate != null);
  const onTime = done.filter(r => r.bucket === 'on_time').length;
  const avgDelay = done.length ? r2(done.reduce((s, r) => s + (r.daysLate ?? 0), 0) / done.length) : 0;
  const last3 = done.slice(-3);
  const lateInARow = last3.length === 3 && last3.every(r => r.bucket !== 'on_time');
  const growing = last3.length === 3 && last3[0].daysLate! < last3[1].daysLate! && last3[1].daysLate! < last3[2].daysLate! && last3[2].daysLate! > 0;
  return {
    rows, last6: rows.slice(-6), count: done.length, onTimePct: done.length ? Math.round((100 * onTime) / done.length) : 100,
    avgDelay, penalty: r2(rows.reduce((s, r) => s + r.penalty, 0)), lateInARow, growing,
  };
}

/* ============================== claims ============================== */

export function penaltyLines(stats: ReturnType<typeof deliveryStats>, period: { from: string; to: string }, contract?: Contract): DeliveryPenaltyLine[] {
  const ref = clauseFor(contract, 'delivery_penalty_pct_day')?.ref;
  return stats.rows
    .filter(r => r.penalty > 0 && r.d.actualAt && r.d.actualAt.slice(0, 10) >= period.from && r.d.actualAt.slice(0, 10) <= period.to)
    .map(r => ({ po: r.d.po, plannedAt: r.d.plannedAt, actualAt: r.d.actualAt!, daysLate: r.daysLate!, billableDays: r.billableDays, amount: r.penalty, clauseRef: ref }));
}

/**
 * Deterministic part of a claim: cases, amounts by contract formula, delivery penalties, clause references.
 * Only level A/B confirmed manufacturing cases of batches over the allowance, not yet in another claim.
 */
export function assembleClaim(args: {
  supplier: Supplier; contract?: Contract; batches: Batch[]; cases: DefectCase[]; deliveries: Delivery[];
  period: { from: string; to: string }; number: string; nowIso: string;
  /** Earlier claims: their cases and delivery POs are never claimed twice. */
  claims?: Claim[];
}): Claim | null {
  const { supplier, contract, period } = args;
  const t = termsOf(supplier, contract);
  const inPeriod = (c: DefectCase) => c.receivedAt.slice(0, 10) >= period.from && c.receivedAt.slice(0, 10) <= period.to;
  const free = (c: DefectCase) => !c.claimId && c.status === 'evidenced' && inPeriod(c);

  const lines: BatchDefectLine[] = [];
  const caseIds: string[] = [];
  let defectAmount = 0;
  let direct = 0;
  for (const b of args.batches.filter(x => x.supplierId === supplier.id)) {
    const line = batchLine(b, args.cases, t, contract);
    if (!line.overAllowance) continue;
    const eligible = line.cases_.filter(free).sort((a, c) => a.receivedAt.localeCompare(c.receivedAt));
    // excess_only: the first `allowed` confirmed cases of the batch are the factory's allowance
    const allowedCases = Math.floor((line.allowedPct / 100) * (line.soldUnits ?? b.qty));
    const already = line.cases_.filter(c => c.claimId).length;
    const skip = t.compensationBasis === 'excess_only' ? Math.max(0, allowedCases - already) : 0;
    const take = eligible.slice(skip);
    if (!take.length) continue;
    const amount = r2(take.reduce((s, c) => s + claimableCaseCost(b, c, t), 0));
    defectAmount += amount;
    direct += directDamage(b, line.cases);
    caseIds.push(...take.map(c => c.id));
    const { cases_: _omit, ...plain } = line;
    lines.push({ ...plain, compensatedCases: take.length, amount });
  }

  const stats = deliveryStats(args.deliveries.filter(d => d.supplierId === supplier.id), t);
  const claimedPos = new Set((args.claims ?? []).filter(c => c.status !== 'withdrawn').flatMap(c => c.deliveryPenalties.map(p => p.po)));
  const penalties = penaltyLines(stats, period, contract).filter(p => !claimedPos.has(p.po));
  const deliveryAmount = r2(penalties.reduce((s, p) => s + p.amount, 0));
  if (!caseIds.length && !penalties.length) return null;

  const amount = r2(defectAmount + deliveryAmount);
  const picked = args.cases.filter(c => caseIds.includes(c.id));
  const srcCount = (k: string) => picked.reduce((s, c) => s + (c.sources ?? []).filter(x => x.source === k).length, 0);
  const refs = (['defect_allowance_pct', 'compensation_basis', 'warranty_months', 'delivery_penalty_pct_day', 'claim_response_days', 'evidence_standard'] as ClauseTopic[])
    .map(topic => clauseFor(contract, topic))
    .filter((c): c is ContractClause => !!c)
    .map(c => ({ ref: c.ref, topic: c.topic, quote: c.quote }));

  const options: CompensationOption[] = [
    { form: 'credit_note', value: amount, description: `Credit note of ${amount} ${supplier.currency} deducted from the next purchase order` },
    { form: 'free_parts', value: r2(amount * 1.15), description: `Free spare parts (cartridges, seals, valve bodies) worth ${r2(amount * 1.15)} ${supplier.currency} at factory price, loaded into the next container` },
    { form: 'warranty_extension', value: r2(amount * 0.6), description: `Partial credit of ${r2(amount * 0.6)} ${supplier.currency} plus warranty on affected SKUs extended by 12 months` },
  ];
  const worst = [...lines].sort((a, b) => b.pct - a.pct)[0];
  const proposedClauses = [
    `Defect allowance: manufacturing defects above ${worst ? worst.allowedPct : t.allowedDefectPct}% per batch are compensated at landed cost per case, logistics and service included.`,
    `Traceability: batch number and QR code on every product label and carton; claims without them are attributed by our stock records.`,
    `Pre-shipment inspection: AQL 1.0 for critical defects${worst ? ` on ${worst.sku}` : ''}, with a pressure / leak test on every carton sample.`,
    ...(penalties.length ? [`Delivery: confirmed dates are binding; ${t.deliveryPenaltyPctPerDay}% of the shipment value per day after ${t.deliveryGraceDays} days of grace.`] : []),
  ];

  return {
    id: `cl-${args.number.toLowerCase()}`,
    number: args.number,
    supplierId: supplier.id,
    periodFrom: period.from,
    periodTo: period.to,
    currency: supplier.currency,
    caseIds,
    batches: lines,
    defectAmount: r2(defectAmount),
    deliveryPenalties: penalties,
    deliveryAmount,
    amount,
    directDamage: r2(direct),
    clauseRefs: refs,
    options,
    proposedClauses,
    evidence: {
      photos: picked.reduce((s, c) => s + (c.photos ?? 0), 0),
      reclamations: srcCount('reclamation'),
      serviceActs: srcCount('service_center'),
      marketplace: srcCount('marketplace'),
    },
    letters: {},
    status: 'draft',
    createdAt: args.nowIso,
    history: [{ at: args.nowIso, status: 'draft', role: 'agent', note: 'assembled from evidence' }],
  };
}

/** Who may move a claim, and where. A person always approves the final claim. */
export const CLAIM_FLOW: Record<ClaimStatus, { to: ClaimStatus; roles: Role[] }[]> = {
  draft: [{ to: 'reviewed', roles: ['buyer'] }, { to: 'withdrawn', roles: ['buyer', 'management'] }],
  reviewed: [{ to: 'sent', roles: ['buyer'] }, { to: 'draft', roles: ['buyer'] }],
  sent: [{ to: 'acknowledged', roles: ['buyer'] }, { to: 'disputed', roles: ['buyer'] }],
  acknowledged: [{ to: 'paid', roles: ['buyer', 'management'] }],
  disputed: [{ to: 'legal', roles: ['buyer', 'management'] }, { to: 'acknowledged', roles: ['buyer'] }],
  legal: [{ to: 'acknowledged', roles: ['management'] }, { to: 'withdrawn', roles: ['management'] }],
  paid: [],
  withdrawn: [],
};

export function canMove(from: ClaimStatus, to: ClaimStatus, role: Role): boolean {
  return CLAIM_FLOW[from].some(x => x.to === to && x.roles.includes(role));
}

export function moveClaim(claim: Claim, to: ClaimStatus, role: Role, nowIso: string, extra: { note?: string; paidAmount?: number; responseDays?: number } = {}): Claim {
  if (!canMove(claim.status, to, role)) throw new Error(`${role} cannot move a claim from ${claim.status} to ${to}`);
  if (to === 'sent' && !(claim.letters.en || claim.letters.zh || claim.letters.ru)) throw new Error('write the letter before sending');
  const c: Claim = { ...claim, history: [...claim.history], status: to };
  if (to === 'reviewed') c.reviewedBy = role;
  if (to === 'sent') {
    c.sentAt = nowIso;
    c.dueAt = new Date(Date.parse(nowIso) + (extra.responseDays ?? 15) * DAY).toISOString();
  }
  if (to === 'acknowledged' || to === 'disputed') c.repliedAt = c.repliedAt ?? nowIso;
  if (to === 'paid') {
    const paid = extra.paidAmount ?? c.amount;
    if (!(paid > 0) || paid > c.amount * 1.5) throw new Error('paid amount looks wrong');
    c.paidAmount = r2(paid);
    c.paidAt = nowIso;
  }
  c.history.push({ at: nowIso, status: to, role, note: extra.note });
  return c;
}

export const slaOverdue = (c: Claim, nowIso: string) => c.status === 'sent' && !!c.dueAt && c.dueAt < nowIso;

/* ============================== scorecard & flags ============================== */

export interface SupplierScore {
  supplier: Supplier;
  total: number;
  parts: { quality: number; delivery: number; claims: number; response: number };
  band: 'control' | 'improve' | 'priority';
  facts: { worstPct: number; allowedPct: number; onTimePct: number; avgDelay: number; claimsSent: number; claimsAccepted: number; avgResponseDays: number | null };
}

export function scoreSupplier(args: {
  supplier: Supplier; contract?: Contract; batches: Batch[]; cases: DefectCase[]; deliveries: Delivery[]; claims: Claim[];
  settings?: ScoreSettings; nowIso: string;
}): SupplierScore {
  const s = args.settings ?? DEFAULT_SETTINGS;
  const t = termsOf(args.supplier, args.contract);
  const lines = args.batches.filter(b => b.supplierId === args.supplier.id).map(b => batchLine(b, args.cases, t, args.contract));
  // quality: worst ratio of defect rate to allowance (≤0.5× → 100, ≥2× → 0)
  const ratios = lines.map(l => (l.allowedPct ? l.pct / l.allowedPct : 0));
  const worst = lines.length ? lines[ratios.indexOf(Math.max(...ratios))] : undefined;
  const worstRatio = ratios.length ? Math.max(...ratios) : 0;
  const quality = clamp(100 * (1 - Math.max(0, worstRatio - 0.5) / 1.5));
  // delivery: share on time and average delay
  const ds = deliveryStats(args.deliveries.filter(d => d.supplierId === args.supplier.id), t);
  const delivery = clamp(0.6 * ds.onTimePct + 0.4 * clamp(100 - ds.avgDelay * 5));
  // claims: accepted vs decided
  const mine = args.claims.filter(c => c.supplierId === args.supplier.id && c.status !== 'draft' && c.status !== 'reviewed' && c.status !== 'withdrawn');
  const decided = mine.filter(c => ['acknowledged', 'paid', 'disputed', 'legal'].includes(c.status));
  const accepted = decided.filter(c => c.status === 'acknowledged' || c.status === 'paid').length;
  const claims = decided.length ? (100 * accepted) / decided.length : 100;
  // response: days to reply vs SLA (still open replies count as elapsed so far)
  const resp = mine.map(c => (c.repliedAt ? days(c.sentAt!, c.repliedAt) : c.sentAt ? days(c.sentAt, args.nowIso) : null)).filter((x): x is number => x != null);
  const avgResp = resp.length ? resp.reduce((a, b) => a + b, 0) / resp.length : null;
  const sla = t.claimResponseDays;
  const response = avgResp == null ? 100 : clamp(100 * (1 - Math.max(0, avgResp - sla / 2) / (sla * 1.5)));

  const w = s.weights;
  const wsum = w.quality + w.delivery + w.claims + w.response || 1;
  const total = Math.round((quality * w.quality + delivery * w.delivery + claims * w.claims + response * w.response) / wsum);
  return {
    supplier: args.supplier,
    total,
    parts: { quality: Math.round(quality), delivery: Math.round(delivery), claims: Math.round(claims), response: Math.round(response) },
    band: total < s.bands.control ? 'control' : total > s.bands.priority ? 'priority' : 'improve',
    facts: { worstPct: worst?.pct ?? 0, allowedPct: worst?.allowedPct ?? t.allowedDefectPct, onTimePct: ds.onTimePct, avgDelay: ds.avgDelay, claimsSent: mine.length, claimsAccepted: accepted, avgResponseDays: avgResp == null ? null : Math.round(avgResp) },
  };
}

export type FlagKind = 'late_in_a_row' | 'delay_growing' | 'repeat_defect' | 'claim_sla' | 'over_allowance';
export interface RiskFlag { kind: FlagKind; supplierId: string; text: { ru: string; en: string }; ref?: string }

export function riskFlags(args: {
  suppliers: Supplier[]; contracts: Contract[]; batches: Batch[]; cases: DefectCase[]; deliveries: Delivery[]; claims: Claim[]; nowIso: string;
}): RiskFlag[] {
  const out: RiskFlag[] = [];
  for (const s of args.suppliers) {
    const contract = args.contracts.find(c => c.id === s.contractId);
    const t = termsOf(s, contract);
    const ds = deliveryStats(args.deliveries.filter(d => d.supplierId === s.id), t);
    if (ds.lateInARow) out.push({ kind: 'late_in_a_row', supplierId: s.id, text: { ru: `${s.code}: 3 поставки подряд с опозданием, в среднем ${ds.avgDelay} дн.`, en: `${s.code}: 3 late deliveries in a row, avg ${ds.avgDelay} d` } });
    else if (ds.growing) out.push({ kind: 'delay_growing', supplierId: s.id, text: { ru: `${s.code}: опоздания растут три поставки подряд`, en: `${s.code}: delays growing three deliveries in a row` } });

    const sb = args.batches.filter(b => b.supplierId === s.id);
    for (const b of sb) {
      const l = batchLine(b, args.cases, t, contract);
      if (l.overAllowance) out.push({ kind: 'over_allowance', supplierId: s.id, ref: b.code, text: { ru: `${b.code} (${b.sku}): брак ${l.pct}% при допуске ${l.allowedPct}%`, en: `${b.code} (${b.sku}): ${l.pct}% defects vs ${l.allowedPct}% allowed` } });
    }
    // the same defect family in two or more batches of this factory
    const byCode = new Map<string, Set<string>>();
    for (const c of args.cases.filter(c => c.supplierId === s.id && isConfirmed(c) && c.defectCode && c.defectCode !== 'other' && c.batchId)) {
      if (!byCode.has(c.defectCode!)) byCode.set(c.defectCode!, new Set());
      byCode.get(c.defectCode!)!.add(c.batchId!);
    }
    for (const [code, set] of byCode) {
      if (set.size >= 2) {
        const codes = sb.filter(b => set.has(b.id)).map(b => b.code);
        out.push({ kind: 'repeat_defect', supplierId: s.id, text: { ru: `${s.code}: дефект «${DEFECT_RU[code] ?? code}» повторяется в ${set.size} партиях (${codes.join(', ')})`, en: `${s.code}: "${code}" defect repeats in ${set.size} batches (${codes.join(', ')})` } });
      }
    }
    for (const c of args.claims.filter(c => c.supplierId === s.id && slaOverdue(c, args.nowIso))) {
      out.push({ kind: 'claim_sla', supplierId: s.id, ref: c.number, text: { ru: `${s.code}: нет ответа на претензию ${c.number} дольше ${t.claimResponseDays} дн.`, en: `${s.code}: no reply to claim ${c.number} beyond ${t.claimResponseDays} days` } });
    }
  }
  return out;
}

export const DEFECT_RU: Record<string, string> = {
  cartridge_seal: 'течь картриджа / уплотнения', coating: 'отслоение покрытия', casting: 'пористость литья', thread: 'брак резьбы',
  valve: 'неисправность клапана', heating_element: 'нагревательный элемент', lid_hinge: 'механизм крышки', switch: 'переключатель',
  packaging: 'упаковка', other: 'другое',
};
