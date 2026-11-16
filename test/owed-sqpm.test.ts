import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeCase } from '../src/owed/tools/attribution';
import { decide } from '../src/owed/tools/decide';
import { DEMO_BATCHES, DEMO_CONTRACTS, DEMO_DELIVERIES, DEMO_SUPPLIERS } from '../src/owed/fixtures';
import { demoData } from '../src/owed/seed';
import {
  assembleClaim, batchLine, canMove, deliveryStats, directDamage, findDuplicate, funnel, moveClaim, riskFlags,
  scoreSupplier, slaOverdue, termsOf, verifyClause,
} from '../src/owed/sqpm';
import type { DefectCase, MarketplaceOrder } from '../src/owed/types';

const NOW = '2026-11-16T10:00:00Z';
const A = DEMO_SUPPLIERS.find(s => s.code === 'F-A')!;
const ctA = DEMO_CONTRACTS.find(c => c.id === A.contractId)!;

/* ---------------- attribution ladder A–D ---------------- */

test('A: serial number or label batch code gives the exact batch', () => {
  assert.equal(attributeCase({ batches: DEMO_BATCHES }, { sku: 'SH-120', serial: 301234 }).level, 'A');
  const lab = attributeCase({ batches: DEMO_BATCHES }, { sku: 'SH-120', labelBatchCode: 'B-2026-079' });
  assert.equal(lab.level, 'A');
  assert.equal(lab.method, 'label');
  assert.equal(lab.batch?.supplierId, 'sup-d');
});

test('B: marketplace order → ship date → only one factory in stock (FIFO batch)', () => {
  const orders: MarketplaceOrder[] = [{ orderNo: 'WB-1', sku: 'SH-120', shippedAt: '2026-09-15', clientKey: 'x' }];
  const a = attributeCase({ batches: DEMO_BATCHES, orders }, { sku: 'SH-120', orderNo: 'WB-1' });
  assert.equal(a.level, 'B');
  assert.equal(a.method, 'order_stock');
  assert.equal(a.batch?.code, 'B-2026-084');
});

test('C: the order shipped while two factories had stock — analytics only, never a claim', () => {
  const orders: MarketplaceOrder[] = [{ orderNo: 'WB-2', sku: 'SH-120', shippedAt: '2026-08-15', clientKey: 'x' }];
  const a = attributeCase({ batches: DEMO_BATCHES, orders }, { sku: 'SH-120', orderNo: 'WB-2' });
  assert.equal(a.level, 'C');
  assert.deepEqual(a.candidateSupplierIds.sort(), ['sup-a', 'sup-d']);
  const d = decide({ defectClass: 'manufacturing', confidence: 0.95, attribution: a.method, level: a.level, hasBatch: true });
  assert.equal(d.recoverable, false);
  assert.equal(d.status, 'analytics_only');
});

test('D: nothing to go on — wait for the label photo', () => {
  const a = attributeCase({ batches: DEMO_BATCHES }, { sku: 'не указан' });
  assert.equal(a.level, 'D');
  assert.equal(decide({ defectClass: 'manufacturing', confidence: 0.9, attribution: a.method, level: a.level, hasBatch: false }).status, 'awaiting_label');
});

/* ---------------- deduplication ---------------- */

test('dedup: the same order + SKU + client within the window is one case', () => {
  const c = { id: 'c1', sku: 'SH-120', orderNo: 'OZ-9', clientKey: 'cl-1', receivedAt: '2026-10-01T10:00:00Z', externalRef: 'MP-OZ-9', channel: 'marketplace' } as DefectCase;
  assert.equal(findDuplicate([c], { sku: 'sh120', orderNo: 'OZ-9', clientKey: 'cl-1', receivedAt: '2026-10-09T10:00:00Z' })?.by, 'order_key');
  assert.equal(findDuplicate([c], { sku: 'SH-120', orderNo: 'OZ-9', clientKey: 'cl-1', receivedAt: '2026-12-20T10:00:00Z' }), undefined); // outside the window
  assert.equal(findDuplicate([c], { sku: 'SH-120', orderNo: 'OZ-9', clientKey: 'cl-2', receivedAt: '2026-10-02T10:00:00Z' }), undefined); // another customer
  assert.equal(findDuplicate([c], { sku: 'SH-120', receivedAt: '2026-10-02T10:00:00Z', externalRef: 'MP-OZ-9' })?.by, 'ref');
});

/* ---------------- the presentation example ---------------- */

test('batch B-2026-084: 185 confirmed of 5 000 sold = 3.7% vs 2%, direct damage 185 × $18 = $3 330', () => {
  const d = demoData(NOW);
  const b = d.batches.find(x => x.code === 'B-2026-084')!;
  const line = batchLine(b, d.cases, termsOf(A, ctA), ctA);
  assert.equal(line.cases, 185);
  assert.equal(line.pct, 3.7);
  assert.equal(line.allowedPct, 2); // the SKU-specific clause 5.3, not the general 1%
  assert.equal(line.clauseRef, '5.3');
  assert.equal(line.overAllowance, true);
  assert.equal(directDamage(b, line.cases), 3330);
});

test('defect rate is over SOLD units, and only A/B confirmed cases count', () => {
  const d = demoData(NOW);
  const b = d.batches.find(x => x.code === 'B-2026-084')!;
  const sold = { ...b, soldUnits: 2500 };
  assert.equal(batchLine(sold, d.cases, termsOf(A, ctA), ctA).pct, 7.4);
  // the 10 level-C cases of the same SKU are not in the rate
  assert.ok(d.cases.filter(c => c.level === 'C').length >= 10);
});

test('funnel: messages → without duplicates → confirmed → level A/B', () => {
  const f = funnel(0, demoData(NOW).cases);
  assert.ok(f.total > f.unique && f.unique > f.confirmed && f.confirmed > f.ab && f.ab > 0, JSON.stringify(f));
});

/* ---------------- contract formula ---------------- */

test('claim amount follows the contract: all_cases vs excess_only', () => {
  const d = demoData(NOW);
  const claim = assembleClaim({ supplier: A, contract: ctA, batches: d.batches, cases: d.cases, deliveries: d.deliveries, period: { from: '2026-07-01', to: '2026-11-16' }, number: 'CL-T1', nowIso: NOW, claims: d.claims })!;
  const l084 = claim.batches.find(b => b.batchCode === 'B-2026-084')!;
  assert.equal(l084.compensatedCases, 185); // all_cases (clause 5.4)
  assert.equal(l084.amount, 185 * (18 + 8 + 12)); // unit cost + logistics + service
  assert.ok(claim.clauseRefs.some(r => r.ref === '5.4' && r.topic === 'compensation_basis'));
  assert.equal(claim.status, 'draft');
  // an excess_only contract compensates only cases above the allowance
  const ex = { ...ctA, clauses: ctA.clauses.map(c => (c.topic === 'compensation_basis' ? { ...c, basis: 'excess_only' as const } : c)) };
  const claim2 = assembleClaim({ supplier: A, contract: ex, batches: d.batches, cases: d.cases, deliveries: [], period: { from: '2026-07-01', to: '2026-11-16' }, number: 'CL-T2', nowIso: NOW })!;
  assert.equal(claim2.batches.find(b => b.batchCode === 'B-2026-084')!.compensatedCases, 185 - 100);
});

test('cases in a claim and already-claimed deliveries are never billed twice', () => {
  const d = demoData(NOW);
  const D = DEMO_SUPPLIERS.find(s => s.code === 'F-D')!;
  const ctD = DEMO_CONTRACTS.find(c => c.id === D.contractId)!;
  const c1 = assembleClaim({ supplier: D, contract: ctD, batches: d.batches, cases: d.cases, deliveries: d.deliveries, period: { from: '2026-01-01', to: '2026-11-16' }, number: 'CL-T3', nowIso: NOW, claims: d.claims })!;
  assert.equal(c1.deliveryPenalties.length, 1); // only the 5th late delivery; the first four were in CL-2026-010
  const claimed: DefectCase[] = d.cases.map(c => (c.supplierId === 'sup-a' ? { ...c, claimId: 'cl-x' } : c));
  assert.equal(assembleClaim({ supplier: A, contract: ctA, batches: d.batches, cases: claimed, deliveries: [], period: { from: '2026-07-01', to: '2026-11-16' }, number: 'CL-T4', nowIso: NOW }), null);
});

/* ---------------- AI contract analysis guard ---------------- */

test('contract clause is accepted only if quoted verbatim with its reference and number', () => {
  const text = DEMO_CONTRACTS.find(c => c.id === 'ct-e')!.text;
  assert.equal(verifyClause(text, { ref: '6.2', quote: 'For each day of delay beyond the tolerance the Seller pays a penalty of 0.1% of the value of the delayed shipment.', value: 0.1 }).ok, true);
  assert.equal(verifyClause(text, { ref: '6.2', quote: 'For each day of delay the Seller pays a penalty of 0.5% of the value.', value: 0.5 }).ok, false); // paraphrase
  assert.equal(verifyClause(text, { ref: '6.2', quote: 'For each day of delay beyond the tolerance the Seller pays a penalty of 0.1% of the value of the delayed shipment.', value: 0.5 }).ok, false); // wrong number
  assert.equal(verifyClause(text, { ref: '9.9', quote: 'A delay of up to 3 days is tolerated.', value: 3 }).ok, false); // wrong reference
});

/* ---------------- delivery discipline ---------------- */

test('delivery discipline: delays vs contract date, grace, penalty with cap, flags', () => {
  const ds = deliveryStats(DEMO_DELIVERIES.filter(d => d.supplierId === 'sup-a'), termsOf(A, ctA));
  assert.equal(ds.count, 9); // the 10th is in transit
  assert.equal(ds.onTimePct, 44);
  assert.equal(ds.lateInARow, true);
  const last = ds.rows.filter(r => r.daysLate != null).at(-1)!;
  assert.equal(last.daysLate, 32);
  assert.equal(last.billableDays, 27); // 5 days of grace
  assert.equal(last.penalty, Math.round(18400 * 0.001 * 27 * 100) / 100);
  const capped = deliveryStats([{ id: 'x', supplierId: 'sup-a', po: 'P', amount: 1000, currency: 'USD', plannedAt: '2026-01-01', actualAt: '2026-06-01' }], termsOf(A, ctA));
  assert.equal(capped.rows[0].penalty, 50); // 5% cap
});

/* ---------------- scorecard & flags ---------------- */

test('scorecard: weights 35/35/20/10 and bands <60 / 60–80 / >80', () => {
  const d = demoData(NOW);
  const score = (code: string) => {
    const s = d.suppliers.find(x => x.code === code)!;
    return scoreSupplier({ supplier: s, contract: d.contracts.find(c => c.id === s.contractId), batches: d.batches, cases: d.cases, deliveries: d.deliveries, claims: d.claims, nowIso: NOW });
  };
  assert.equal(score('F-A').band, 'control');
  assert.equal(score('F-B').band, 'priority');
  const custom = scoreSupplier({ supplier: A, contract: ctA, batches: d.batches, cases: d.cases, deliveries: d.deliveries, claims: d.claims, nowIso: NOW, settings: { ...d.settings, weights: { quality: 0, delivery: 0, claims: 100, response: 0 } } });
  assert.equal(custom.total, custom.parts.claims);
});

test('risk flags: late in a row, repeat defect across batches, over allowance, claim past SLA', () => {
  const d = demoData(NOW);
  const kinds = new Set(riskFlags({ ...d, nowIso: NOW }).map(f => f.kind));
  for (const k of ['late_in_a_row', 'repeat_defect', 'over_allowance', 'claim_sla']) assert.ok(kinds.has(k as any), k);
});

/* ---------------- claim lifecycle ---------------- */

test('claim lifecycle: only the buyer approves and sends; SLA starts on send; payment recorded', () => {
  const d = demoData(NOW);
  let c = assembleClaim({ supplier: A, contract: ctA, batches: d.batches, cases: d.cases, deliveries: d.deliveries, period: { from: '2026-07-01', to: '2026-11-16' }, number: 'CL-T5', nowIso: NOW, claims: d.claims })!;
  assert.equal(canMove('draft', 'reviewed', 'quality'), false);
  assert.throws(() => moveClaim(c, 'sent', 'buyer', NOW)); // must be reviewed first
  c = moveClaim(c, 'reviewed', 'buyer', NOW);
  assert.throws(() => moveClaim(c, 'sent', 'buyer', NOW), /letter/); // no letter yet
  c = { ...c, letters: { en: 'Dear partner…', zh: '尊敬的…', ru: 'Уважаемые…' } };
  c = moveClaim(c, 'sent', 'buyer', NOW, { responseDays: 15 });
  assert.equal(slaOverdue(c, '2026-11-20T00:00:00Z'), false);
  assert.equal(slaOverdue(c, '2026-12-05T00:00:00Z'), true);
  c = moveClaim(c, 'acknowledged', 'buyer', '2026-11-25T00:00:00Z');
  c = moveClaim(c, 'paid', 'management', '2026-12-10T00:00:00Z', { paidAmount: 9000 });
  assert.equal(c.paidAmount, 9000);
  assert.deepEqual(c.history.map(h => h.status), ['draft', 'reviewed', 'sent', 'acknowledged', 'paid']);
});

/* ---------------- agent with a scripted model ---------------- */
import { runIntake, type ModelClient, type ModelResponse } from '../src/owed/agent';
import { InMemoryStore } from '../src/owed/store';
import { extractContract, templateLetters } from '../src/owed/negotiation';

function scripted(responses: ModelResponse[]): ModelClient {
  let i = 0;
  return { create: async () => responses[Math.min(i++, responses.length - 1)] };
}

test('intake: the same defect from the service centre merges into the marketplace case', async () => {
  const d = demoData(NOW);
  const store = new InMemoryStore(d);
  const mp = d.cases.find(c => c.orderNo && c.level === 'B')!;
  const before = store.cases().then(cs => cs.length);
  const res = await runIntake(scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'record_case', input: { sku: mp.sku, order_no: mp.orderNo, external_ref: 'СЦ-9999', description: 'Thermostatic cartridge leaks after six weeks', defect_class: 'manufacturing', defect_code: 'cartridge_seal', confidence: 0.9, reasoning: 'Seal failure under normal use' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Merged.' }] },
  ]), store, 'Акт СЦ-9999 по заказу', { channel: 'service_act', receivedAt: new Date(Date.parse(mp.receivedAt) + 5 * 86_400_000).toISOString() });
  assert.equal(res.merged, true);
  assert.equal((await store.cases()).length, await before);
  assert.ok(res.case!.sources!.some(s => s.ref === 'СЦ-9999' && s.source === 'service_center'));
});

test('intake: level D asks the customer for a label photo and never reaches the debt', async () => {
  const store = new InMemoryStore(demoData(NOW));
  const res = await runIntake(scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'record_case', input: { sku: 'не указан', description: 'Mixer leaks under the handle, model unknown', defect_class: 'manufacturing', confidence: 0.85, reasoning: 'Leak under normal use' } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'request_label_photo', input: { case_id: '__ID__' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Asked for the label.' }] },
  ] as ModelResponse[]), store, 'Смеситель течёт, модель не знаю', { channel: 'telegram', receivedAt: NOW });
  assert.equal(res.case?.level, 'D');
  assert.equal(res.case?.status, 'awaiting_label');
  assert.equal(res.case?.recoverable, false);
});

test('contract analysis: an invented or paraphrased clause is dropped, a verbatim one is kept unconfirmed', async () => {
  const ct = DEMO_CONTRACTS.find(c => c.id === 'ct-e')!;
  const out = await extractContract(scripted([{ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ clauses: [
    { topic: 'delivery_grace_days', ref: '6.1', quote: 'Delivery dates are fixed in each Purchase Order. A delay of up to 3 days is tolerated.', value: 3 },
    { topic: 'delivery_penalty_pct_day', ref: '6.2', quote: 'The Seller pays 0.5% per day of delay.', value: 0.5 },
    { topic: 'claim_response_days', ref: '7.1', quote: 'The Seller shall reply to a claim within 10 days of receipt; a claim without a reply is deemed accepted.', value: 30 },
  ] }) }] }]), ct);
  assert.deepEqual(out.accepted.map(c => c.ref), ['6.1']);
  assert.equal(out.accepted[0].confirmed, false);
  assert.equal(out.rejected.length, 2);
});

test('claim letters: the template cites clause numbers and the total in all three languages', () => {
  const d = demoData(NOW);
  const c = assembleClaim({ supplier: A, contract: ctA, batches: d.batches, cases: d.cases, deliveries: d.deliveries, period: { from: '2026-07-01', to: '2026-11-16' }, number: 'CL-T9', nowIso: NOW, claims: d.claims })!;
  const l = templateLetters(c, A);
  for (const t of [l.en!, l.zh!, l.ru!]) { assert.ok(t.includes('5.3')); assert.ok(t.includes(String(c.amount))); }
});
