import { PACK_SYSTEM } from './prompts';
import type { ModelClient } from './agent';
import type { Store } from './store';
import { assemblePack } from './tools/pack';
import type { NegotiationPack } from './types';
import { defaultModel } from './llm';

/**
 * Builds a negotiation pack for one factory. Numbers are assembled in code;
 * the model writes the EN letter and its Chinese version. Status stays 'draft'
 * until a human approves it — nothing is sent automatically.
 */
export async function buildPack(
  client: ModelClient,
  store: Store,
  supplierCode: string,
  period: { from: string; to: string },
  model = defaultModel(),
): Promise<NegotiationPack | null> {
  const [suppliers, batches, cases] = await Promise.all([store.suppliers(), store.batches(), store.cases()]);
  const supplier = suppliers.find(s => s.code === supplierCode);
  if (!supplier) throw new Error(`Unknown factory ${supplierCode}`);

  const pack = assemblePack(supplier, batches, cases, period);
  if (!pack) return null;

  const facts = {
    factory: supplier.name,
    period,
    cases: pack.caseIds.length,
    total_amount: `${pack.amount} ${supplier.currency}`,
    defect_rates: pack.defectPctByBatch,
    compensation_options: pack.options.map(o => o.description),
    contract_clauses: pack.contractClauses,
    sample_failures: cases.filter(c => pack.caseIds.includes(c.id)).slice(0, 5).map(c => c.description),
  };

  const res = await client.create({
    model,
    max_tokens: 2000,
    system: PACK_SYSTEM,
    tools: [],
    messages: [{ role: 'user', content: `Facts (use only these):\n${JSON.stringify(facts, null, 2)}` }],
  });
  const raw = res.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  pack.textEn = String(json.text_en ?? '');
  pack.textZh = String(json.text_zh ?? '');

  await store.savePack(pack);
  await store.audit({ at: new Date().toISOString(), actor: 'agent', action: 'pack.drafted', entityId: pack.id, details: { supplier: supplier.code, amount: pack.amount } });
  return pack;
}

/* ======================= SQPM: claim letters & contract analysis ======================= */
import { CLAIM_SYSTEM, CONTRACT_SYSTEM } from './prompts';
import { verifyClause } from './sqpm';
import type { Claim, ClauseTopic, Contract, ContractClause, Supplier } from './types';

const TOPICS: ClauseTopic[] = ['warranty_months', 'defect_allowance_pct', 'compensation_basis', 'evidence_standard', 'delivery_grace_days', 'delivery_penalty_pct_day', 'delivery_penalty_cap_pct', 'claim_response_days'];

function parseJson(raw: string): any {
  const s = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  return JSON.parse(s);
}

export function claimFacts(claim: Claim, supplier: Supplier) {
  return {
    claim_number: claim.number,
    factory: supplier.name,
    period: { from: claim.periodFrom, to: claim.periodTo },
    batches: claim.batches.map(b => ({ batch: b.batchCode, sku: b.sku, confirmed_defects: b.cases, sold_units: b.soldUnits, defect_rate_pct: b.pct, allowance_pct: b.allowedPct, allowance_clause: b.clauseRef, compensated_units: b.compensatedCases, amount: b.amount })),
    defects_amount: `${claim.defectAmount} ${claim.currency}`,
    delivery_penalties: claim.deliveryPenalties.map(p => ({ po: p.po, contract_date: p.plannedAt, arrived: p.actualAt, days_late: p.daysLate, billable_days: p.billableDays, amount: p.amount, clause: p.clauseRef })),
    delivery_amount: `${claim.deliveryAmount} ${claim.currency}`,
    total: `${claim.amount} ${claim.currency}`,
    contract_clauses: claim.clauseRefs.map(c => ({ clause: c.ref, text: c.quote })),
    evidence: claim.evidence,
    compensation_options: claim.options.map(o => o.description),
    proposed_clauses: claim.proposedClauses,
  };
}

/** Letters in EN + ZH (to the factory) and RU (internal). Template fallback keeps the flow working without a model. */
export async function writeClaimLetters(client: ModelClient | undefined, claim: Claim, supplier: Supplier, model = defaultModel(), timeoutMs = 25_000): Promise<Claim['letters']> {
  if (client) {
    try {
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
      const res = await Promise.race([timeout, client.create({ model, max_tokens: 2600, system: CLAIM_SYSTEM, tools: [], messages: [{ role: 'user', content: `Facts (use only these):\n${JSON.stringify(claimFacts(claim, supplier), null, 2)}` }] })]);
      const j = parseJson(res.content.filter(b => b.type === 'text').map(b => (b as any).text).join(''));
      if (j.text_en && j.text_zh) return { en: String(j.text_en), zh: String(j.text_zh), ru: String(j.text_ru ?? ''), source: 'model' };
    } catch { /* fall through to the template */ }
  }
  return templateLetters(claim, supplier);
}

export function templateLetters(c: Claim, s: Supplier): Claim['letters'] {
  const ref = (topic: ClauseTopic) => c.clauseRefs.find(x => x.topic === topic)?.ref;
  const lines = c.batches.map(b => `- ${b.batchCode} (${b.sku}): ${b.cases} confirmed defects of ${b.soldUnits} units sold = ${b.pct}% vs the ${b.allowedPct}% allowance (clause ${b.clauseRef ?? '—'}); ${b.compensatedCases} units claimed, ${b.amount} ${c.currency}`);
  const pen = c.deliveryPenalties.map(p => `- ${p.po}: contract date ${p.plannedAt}, arrived ${p.actualAt.slice(0, 10)}, ${p.daysLate} days late (${p.billableDays} billable) — ${p.amount} ${c.currency}`);
  const en = [
    `Claim ${c.number} — ${s.name}`,
    `Dear partners,`,
    `We have reviewed warranty data for deliveries between ${c.periodFrom} and ${c.periodTo}. Each case below is supported by a defect photo, the serial or batch number and a service report (clause ${ref('evidence_standard') ?? '—'}).`,
    ...lines,
    ...(pen.length ? [`Delivery penalties (clause ${ref('delivery_penalty_pct_day') ?? '—'}):`, ...pen] : []),
    `Total: ${c.amount} ${c.currency} (defects ${c.defectAmount}, delivery ${c.deliveryAmount}).`,
    `Please choose one form of compensation: ${c.options.map((o, i) => `(${i + 1}) ${o.description}`).join('; ')}.`,
    `For the next contract we propose: ${c.proposedClauses.join(' ')}`,
    `Please reply within ${ref('claim_response_days') ? `the term of clause ${ref('claim_response_days')}` : '15 days'}. We value our partnership and look forward to your answer.`,
  ].join('\n');
  const zh = [
    `索赔函 ${c.number} — ${s.name}`,
    `尊敬的合作伙伴：`,
    `我们核查了 ${c.periodFrom} 至 ${c.periodTo} 期间交货的保修数据。以下每个案例均有缺陷照片、序列号或批次号以及维修报告作为证据（合同第 ${ref('evidence_standard') ?? '—'} 条）。`,
    ...c.batches.map(b => `- ${b.batchCode}（${b.sku}）：已售 ${b.soldUnits} 件中确认缺陷 ${b.cases} 件，缺陷率 ${b.pct}%，超过合同允许的 ${b.allowedPct}%（第 ${b.clauseRef ?? '—'} 条）；索赔 ${b.compensatedCases} 件，金额 ${b.amount} ${c.currency}`),
    ...(c.deliveryPenalties.length ? [`延迟交货罚金（第 ${ref('delivery_penalty_pct_day') ?? '—'} 条）：`, ...c.deliveryPenalties.map(p => `- ${p.po}：合同日期 ${p.plannedAt}，实际到货 ${p.actualAt.slice(0, 10)}，延迟 ${p.daysLate} 天 — ${p.amount} ${c.currency}`)] : []),
    `合计：${c.amount} ${c.currency}。`,
    `请从以下补偿方式中选择一种：信用票据抵扣下一订单；免费备件；部分抵扣并延长保修期。`,
    `请在合同第 ${ref('claim_response_days') ?? '—'} 条规定的期限内回复。我们珍视双方的合作，期待您的答复。`,
  ].join('\n');
  const ru = [
    `Претензия ${c.number} — ${s.name}`,
    `Период поставок: ${c.periodFrom} — ${c.periodTo}. Каждый случай подтверждён фото дефекта, серийным или партийным номером и актом сервиса (п. ${ref('evidence_standard') ?? '—'}).`,
    ...c.batches.map(b => `- ${b.batchCode} (${b.sku}): ${b.cases} подтверждённых дефектов на ${b.soldUnits} проданных = ${b.pct}% при допуске ${b.allowedPct}% (п. ${b.clauseRef ?? '—'}); к возмещению ${b.compensatedCases} шт., ${b.amount} ${c.currency}`),
    ...(c.deliveryPenalties.length ? [`Штраф за просрочку поставок (п. ${ref('delivery_penalty_pct_day') ?? '—'}):`, ...c.deliveryPenalties.map(p => `- ${p.po}: по договору ${p.plannedAt}, пришла ${p.actualAt.slice(0, 10)}, опоздание ${p.daysLate} дн. — ${p.amount} ${c.currency}`)] : []),
    `Итого: ${c.amount} ${c.currency}. Варианты компенсации: кредит-нота, запчасти, частичный кредит + продление гарантии. Срок ответа — по п. ${ref('claim_response_days') ?? '—'}.`,
  ].join('\n');
  return { en, zh, ru, source: 'template' };
}

/**
 * AI contract analysis. The model proposes clauses; code keeps only those quoted word for word,
 * with the reference and the number present in the contract. A person confirms them before they count.
 */
export async function extractContract(client: ModelClient, contract: Contract, model = defaultModel()): Promise<{ accepted: ContractClause[]; rejected: { topic: string; ref: string; reason: string }[]; raw?: string }> {
  const res = await client.create({ model, max_tokens: 3000, system: CONTRACT_SYSTEM, tools: [], messages: [{ role: 'user', content: `Contract:\n${contract.text}\n\nReturn only the JSON object.` }] });
  const text = res.content.filter(b => b.type === 'text').map(b => (b as any).text).join('');
  let items: any[] = [];
  try {
    const t = text.trim();
    const j = t.startsWith('[') ? JSON.parse(t.slice(0, t.lastIndexOf(']') + 1)) : parseJson(t);
    items = Array.isArray(j) ? j : Array.isArray(j.clauses) ? j.clauses : Array.isArray(j.terms) ? j.terms : Array.isArray(j.items) ? j.items : Object.values(j).find(Array.isArray) as any[] ?? [];
  } catch { items = []; }
  const accepted: ContractClause[] = [];
  const rejected: { topic: string; ref: string; reason: string }[] = [];
  if (!items.length) return { accepted, rejected: [{ topic: '-', ref: '-', reason: 'the model returned no clauses' }], raw: text.slice(0, 400) };
  for (const raw of items) {
    const topic = String(raw.topic) as ClauseTopic;
    const ref = String(raw.ref ?? '').replace(/^(clause|п\.)\s*/i, '').trim();
    const quote = String(raw.quote ?? raw.text ?? '').replace(/^\s*\d+(\.\d+)*\s+/, '').replace(/^["«“]|["»”]$/g, '').trim();
    const num = typeof raw.value === 'string' ? Number(String(raw.value).replace(',', '.').replace(/[^\d.]/g, '')) : raw.value;
    const value = num == null || num === '' || !Number.isFinite(Number(num)) ? undefined : Number(num);
    if (!TOPICS.includes(topic)) { rejected.push({ topic, ref, reason: 'unknown topic' }); continue; }
    const v = verifyClause(contract.text, { ref, quote, value: Number.isFinite(value) ? value : undefined });
    if (!v.ok) { rejected.push({ topic, ref, reason: v.reason ?? 'not verified' }); continue; }
    const basis = topic === 'compensation_basis' ? (raw.basis === 'excess_only' ? 'excess_only' : raw.basis === 'all_cases' ? 'all_cases' : undefined) : undefined;
    if (topic === 'compensation_basis' && !basis) { rejected.push({ topic, ref, reason: 'basis not stated' }); continue; }
    accepted.push({ topic, ref, quote, value: Number.isFinite(value) ? value : undefined, sku: raw.sku ? String(raw.sku) : undefined, basis, confirmed: false, extractedBy: 'agent' });
  }
  return { accepted, rejected, raw: accepted.length ? undefined : text.slice(0, 400) };
}
