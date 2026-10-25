/**
 * OWED accuracy eval on synthetic complaints (RU / EN / AR / TR).
 *   npm run eval:owed
 * Requires ANTHROPIC_API_KEY. Writes evals/owed/results-<timestamp>.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { anthropicClient, runIntake } from '../../src/owed/agent.js';
import { DEMO_BATCHES, DEMO_SUPPLIERS } from '../../src/owed/fixtures.js';
import { InMemoryStore } from '../../src/owed/store.js';

interface EvalCase { id: string; text: string; expect: { class: string; batch: string | null; status: string } }

const cases: EvalCase[] = readFileSync(new URL('./cases.jsonl', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map(l => JSON.parse(l));

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}
const client = await anthropicClient();
const batchCode = new Map(DEMO_BATCHES.map(b => [b.id, b.code]));

interface Row {
  id: string;
  expect: EvalCase['expect'];
  got: { class: string; batch: string | null | undefined; status: string; confidence: number } | null;
  classOk: boolean;
  batchOk: boolean;
  statusOk: boolean;
  toolCalls: string[];
  ms: number;
}
const rows: Row[] = [];
for (const c of cases) {
  const store = new InMemoryStore(DEMO_SUPPLIERS, DEMO_BATCHES);
  const t0 = Date.now();
  const res = await runIntake(client, store, c.text, { channel: 'eval', receivedAt: '2026-10-01T10:00:00Z' });
  const got = res.case;
  const row = {
    id: c.id,
    expect: c.expect,
    got: got ? { class: got.defectClass, batch: got.batchId ? batchCode.get(got.batchId) : null, status: got.status, confidence: got.confidence } : null,
    classOk: got?.defectClass === c.expect.class,
    batchOk: (got?.batchId ? batchCode.get(got.batchId) : null) === c.expect.batch,
    statusOk: got?.status === c.expect.status,
    toolCalls: res.trace.map(s => s.tool),
    ms: Date.now() - t0,
  };
  rows.push(row);
  console.log(`${c.id} class:${row.classOk ? '✓' : '✗'} batch:${row.batchOk ? '✓' : '✗'} status:${row.statusOk ? '✓' : '✗'}  ${row.got?.class ?? '-'} / ${row.got?.status ?? '-'}`);
}

const pct = (k: 'classOk' | 'batchOk' | 'statusOk') => Math.round((100 * rows.filter(r => r[k]).length) / rows.length);
const summary = {
  n: rows.length,
  class_accuracy_pct: pct('classOk'),
  batch_accuracy_pct: pct('batchOk'),
  status_accuracy_pct: pct('statusOk'),
  // the costly error: a non-factory defect sent to the factory ledger
  false_recoverable: rows.filter(r => r.got?.status === 'evidenced' && r.expect.status !== 'evidenced').length,
  avg_ms: Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length),
};
console.log('\n', summary);
writeFileSync(new URL(`./results-${Date.now()}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 2));
