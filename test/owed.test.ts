import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeBatch } from '../src/owed/tools/attribution';
import { computeCaseCost } from '../src/owed/tools/cost';
import { decide } from '../src/owed/tools/decide';
import { detectSpikes } from '../src/owed/tools/spikes';
import { assemblePack } from '../src/owed/tools/pack';
import { withinFactoryWarranty } from '../src/owed/tools/warranty';
import { redact } from '../src/owed/redact';
import { DEMO_BATCHES, DEMO_SUPPLIERS } from '../src/owed/fixtures';
import { InMemoryStore } from '../src/owed/store';
import { runIntake, type ModelClient, type ModelResponse } from '../src/owed/agent';
import type { DefectCase } from '../src/owed/types';

test('attribution by serial picks the exact batch', () => {
  const a = attributeBatch(DEMO_BATCHES, 'mx-210', 102311);
  assert.equal(a.method, 'serial');
  assert.equal(a.batch?.code, 'B-2026-058');
});

test('attribution without serial on multi-batch SKU is a flagged guess', () => {
  const a = attributeBatch(DEMO_BATCHES, 'MX-210');
  assert.equal(a.method, 'sku_latest_batch_guess');
  assert.equal(a.batch?.code, 'B-2026-058');
  assert.equal(a.candidates, 2);
});

test('attribution tolerates Cyrillic look-alikes, missing dash and phonetic typing', () => {
  assert.equal(attributeBatch(DEMO_BATCHES, 'МХ-210', 102340).batch?.code, 'B-2026-058'); // Cyrillic М, Х
  assert.equal(attributeBatch(DEMO_BATCHES, 'mx210', 100777).batch?.code, 'B-2026-031');
  assert.equal(attributeBatch(DEMO_BATCHES, 'вл15', 900500).batch?.code, 'B-2026-061');
});

test('attribution: single-batch SKU and unknown SKU', () => {
  assert.equal(attributeBatch(DEMO_BATCHES, 'KT-550').method, 'sku_single_batch');
  assert.equal(attributeBatch(DEMO_BATCHES, 'ZZ-1').method, 'none');
});

test('cost is deterministic and uses defaults', () => {
  const b = DEMO_BATCHES.find(x => x.code === 'B-2026-058')!;
  assert.deepEqual(computeCaseCost(b), { part: 10.92, labour: 12, logistics: 8, compensation: 0, total: 30.92 });
  assert.equal(computeCaseCost(b, { labour: 20, compensation: 15 }).total, 53.92);
});

test('decide: only manufacturing + batch + warranty is recoverable', () => {
  assert.equal(decide({ defectClass: 'manufacturing', confidence: 0.9, attribution: 'serial', hasBatch: true }).status, 'evidenced');
  assert.equal(decide({ defectClass: 'installation', confidence: 0.9, attribution: 'serial', hasBatch: true }).status, 'not_recoverable');
  assert.equal(decide({ defectClass: 'manufacturing', confidence: 0.5, attribution: 'serial', hasBatch: true }).status, 'needs_review');
  assert.equal(decide({ defectClass: 'manufacturing', confidence: 0.9, attribution: 'sku_latest_batch_guess', hasBatch: true }).status, 'needs_review');
  const out = decide({ defectClass: 'manufacturing', confidence: 0.95, attribution: 'serial', hasBatch: true, withinFactoryWarranty: false });
  assert.equal(out.recoverable, false);
});

test('factory warranty window', () => {
  const b = DEMO_BATCHES.find(x => x.code === 'B-2026-061')!; // 12 months from 2026-06-28
  const s = DEMO_SUPPLIERS.find(x => x.id === b.supplierId)!;
  assert.equal(withinFactoryWarranty(b, s, '2027-06-01T00:00:00Z'), true);
  assert.equal(withinFactoryWarranty(b, s, '2027-07-01T00:00:00Z'), false);
});

test('redaction removes phone, email and address', () => {
  const r = redact('Иван, тел +7 701 123 45 67, ivan@mail.ru, ул. Абая 10 — течёт смеситель');
  assert.ok(!r.text.includes('701'));
  assert.ok(!r.text.includes('ivan@'));
  assert.ok(r.text.includes('[address]'));
  assert.ok(r.removed >= 3);
});

function mkCase(batchCode: string, cls: DefectCase['defectClass'], i: number): DefectCase {
  const b = DEMO_BATCHES.find(x => x.code === batchCode)!;
  return {
    id: `c-${batchCode}-${i}`, channel: 'test', receivedAt: '2026-09-10T10:00:00Z', sku: b.sku, batchId: b.id, supplierId: b.supplierId,
    attribution: 'serial', description: 'leak', defectClass: cls, confidence: 0.9, reasoning: 'x',
    cost: computeCaseCost(b), recoverable: cls === 'manufacturing', needsReview: false, reviewReasons: [], status: cls === 'manufacturing' ? 'evidenced' : 'not_recoverable',
  };
}

test('spike detection flags batch above contract allowance', () => {
  const cases = [...Array.from({ length: 25 }, (_, i) => mkCase('B-2026-058', 'manufacturing', i)), ...Array.from({ length: 3 }, (_, i) => mkCase('B-2026-031', 'manufacturing', i))];
  const rates = detectSpikes(DEMO_BATCHES, DEMO_SUPPLIERS, cases);
  const hot = rates.find(r => r.batch.code === 'B-2026-058')!;
  assert.equal(hot.pct, 1.25);
  assert.equal(hot.alert, true);
  assert.equal(rates.find(r => r.batch.code === 'B-2026-031')!.alert, false);
});

test('pack totals only evidenced recoverable cases of that factory in period', () => {
  const cases = [mkCase('B-2026-058', 'manufacturing', 1), mkCase('B-2026-058', 'manufacturing', 2), mkCase('B-2026-058', 'installation', 3), mkCase('B-2026-044', 'manufacturing', 4)];
  const pack = assemblePack(DEMO_SUPPLIERS[0], DEMO_BATCHES, cases, { from: '2026-09-01', to: '2026-09-30' })!;
  assert.equal(pack.caseIds.length, 2);
  assert.equal(pack.amount, 61.84);
  assert.equal(pack.options.length, 3);
  assert.equal(pack.status, 'draft');
});

/* ---- agent loop with a scripted model (no API key needed) ---- */
function scripted(responses: ModelResponse[]): ModelClient {
  let i = 0;
  return { create: async () => responses[Math.min(i++, responses.length - 1)] };
}

test('agent loop: find_batch → record_case → summary; server overrides model claims', async () => {
  const store = new InMemoryStore(DEMO_SUPPLIERS, DEMO_BATCHES);
  const client = scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'find_batch', input: { sku: 'MX-210', serial: 102311 } }] },
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't2', name: 'record_case', input: { sku: 'MX-210', serial: 102311, description: 'Cartridge leaks after two months of normal use', defect_class: 'manufacturing', confidence: 0.9, reasoning: 'Seal failure under normal use' } }],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Recorded against F-A.' }] },
  ]);
  const res = await runIntake(client, store, 'MX-210 серия 102311 течёт, звоните +7 701 123 45 67', { channel: 'test', receivedAt: '2026-09-10T10:00:00Z' });
  assert.equal(res.trace.length, 2);
  assert.equal(res.case?.status, 'evidenced');
  assert.equal(res.case?.cost.total, 30.92);
  assert.equal(res.redactions, 1);
  assert.equal((await store.cases()).length, 1);
});

test('agent loop: invalid tool input becomes an error result, not a crash', async () => {
  const store = new InMemoryStore(DEMO_SUPPLIERS, DEMO_BATCHES);
  const client = scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'record_case', input: { sku: 'MX-210', defect_class: 'broken', confidence: 3 } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Could not record.' }] },
  ]);
  const res = await runIntake(client, store, 'MX-210 сломался', { channel: 'test' });
  assert.ok((res.trace[0].output as any).error);
  assert.equal((await store.cases()).length, 0);
});
