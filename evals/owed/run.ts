/**
 * OWED accuracy eval.
 *   npm run eval:owed                 # basic synthetic set (cases.jsonl)
 *   npm run eval:owed -- hard         # adversarial set (hard_cases.jsonl)
 * Requires OPENAI_API_KEY or ANTHROPIC_API_KEY. Writes evals/owed/results-<set>-<timestamp>.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { runIntake } from '../../src/owed/agent';
import { DEMO_BATCHES, DEMO_SUPPLIERS } from '../../src/owed/fixtures';
import { InMemoryStore } from '../../src/owed/store';
import { getModelClient } from '../../src/owed/llm';
import { computeCaseCost } from '../../src/owed/tools/cost';

interface Expect { class?: string; batch?: string | null; status?: string; duplicate?: boolean; total_min?: number; no_pii?: boolean }
interface EvalCase { id: string; tag?: string; text: string; received_at?: string; prior_ref?: string; expect: Expect }

const set = process.argv[2] === 'hard' ? 'hard' : 'basic';
const file = set === 'hard' ? './hard_cases.jsonl' : './cases.jsonl';
const cases: EvalCase[] = readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
  console.error('Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  process.exit(1);
}
const client = await getModelClient();
const batchCode = new Map(DEMO_BATCHES.map(b => [b.id, b.code]));
const PII = [/\d{3}[\s-]?\d{2}[\s-]?\d{2}/, /@/, /Абая/, /Мари[яи]/, /Петров/];

interface Row {
  id: string; tag?: string; expect: Expect;
  got: { class?: string; batch?: string | null; status?: string; total?: number; duplicate: boolean } ;
  checks: Record<string, boolean>;
  ok: boolean; toolCalls: string[]; ms: number; error?: string;
}
const rows: Row[] = [];

for (const c of cases) {
  const store = new InMemoryStore(DEMO_SUPPLIERS, DEMO_BATCHES);
  if (c.prior_ref) {
    const b = DEMO_BATCHES[1];
    await store.saveCase({
      id: randomUUID(), externalRef: c.prior_ref, channel: 'eval', receivedAt: '2026-09-20T10:00:00Z', sku: b.sku, batchId: b.id, supplierId: b.supplierId,
      attribution: 'serial', description: 'prior record', defectClass: 'manufacturing', confidence: 0.9, reasoning: 'prior', cost: computeCaseCost(b),
      recoverable: true, needsReview: false, reviewReasons: [], status: 'evidenced',
    });
  }
  const t0 = Date.now();
  let row: Row;
  try {
    const res = await runIntake(client, store, c.text, { channel: 'eval', receivedAt: c.received_at ?? '2026-10-01T10:00:00Z' });
    const k = res.case;
    const got = { class: k?.defectClass, batch: k?.batchId ? batchCode.get(k.batchId) ?? null : k ? null : undefined, status: k?.status, total: k?.cost.total, duplicate: !!res.duplicate };
    const e = c.expect;
    const checks: Record<string, boolean> = {};
    if (e.duplicate !== undefined) checks.duplicate = got.duplicate === e.duplicate && (!e.duplicate || !k);
    if (e.class) checks.class = got.class === e.class;
    if (e.batch !== undefined) checks.batch = got.batch === e.batch;
    if (e.status) checks.status = got.status === e.status;
    if (e.total_min !== undefined) checks.total = (got.total ?? 0) >= e.total_min;
    if (e.no_pii) checks.no_pii = !!k && !PII.some(p => p.test(k.description + ' ' + k.reasoning));
    row = { id: c.id, tag: c.tag, expect: e, got, checks, ok: Object.values(checks).every(Boolean), toolCalls: res.trace.map(s => s.tool), ms: Date.now() - t0 };
  } catch (err: any) {
    row = { id: c.id, tag: c.tag, expect: c.expect, got: { duplicate: false }, checks: { run: false }, ok: false, toolCalls: [], ms: Date.now() - t0, error: err?.message };
  }
  rows.push(row);
  const marks = Object.entries(row.checks).map(([k, v]) => `${k}:${v ? '✓' : '✗'}`).join(' ');
  console.log(`${c.id} ${(c.tag ?? '').padEnd(22)} ${marks}  → ${row.got.class ?? '-'} / ${row.got.status ?? (row.got.duplicate ? 'duplicate' : '-')}${row.error ? '  ERR ' + row.error : ''}`);
}

const share = (k: string) => {
  const rel = rows.filter(r => k in r.checks);
  return rel.length ? Math.round((100 * rel.filter(r => r.checks[k]).length) / rel.length) : null;
};
const summary = {
  set,
  model: process.env.LLM_PROVIDER === 'anthropic' ? process.env.OWED_MODEL : process.env.OPENAI_MODEL,
  n: rows.length,
  all_checks_passed_pct: Math.round((100 * rows.filter(r => r.ok).length) / rows.length),
  class_accuracy_pct: share('class'),
  batch_accuracy_pct: share('batch'),
  status_accuracy_pct: share('status'),
  // costly error 1: non-factory defect booked to the factory ledger
  false_recoverable: rows.filter(r => r.got.status === 'evidenced' && r.expect.status && r.expect.status !== 'evidenced').length,
  // costly error 2: real factory defect missed (not evidenced and not sent to review)
  missed_recoverable: rows.filter(r => r.expect.status === 'evidenced' && r.got.status !== 'evidenced' && r.got.status !== 'needs_review').length,
  failed_ids: rows.filter(r => !r.ok).map(r => `${r.id}(${r.tag ?? ''})`),
  avg_ms: Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length),
};
console.log('\n', summary);
writeFileSync(new URL(`./results-${set}-${Date.now()}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 2));
