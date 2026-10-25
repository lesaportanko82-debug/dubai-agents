import { PACK_SYSTEM } from './prompts.js';
import type { ModelClient } from './agent.js';
import type { Store } from './store.js';
import { assemblePack } from './tools/pack.js';
import type { NegotiationPack } from './types.js';

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
  model = process.env.OWED_MODEL ?? 'claude-sonnet-5-5',
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
