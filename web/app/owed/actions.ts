'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { owedContext, owedDb, ROLES } from '@/lib/owed-server';
import { loadRootEnv } from '@/lib/env';
import { decide } from '@core/owed/tools/decide';
import { attributeCase } from '@core/owed/tools/attribution';
import { assembleClaim, moveClaim, termsOf } from '@core/owed/sqpm';
import { extractContract, writeClaimLetters } from '@core/owed/negotiation';
import { getModelClient } from '@core/owed/llm';
import type { ClaimStatus, DefectClass, Role } from '@core/owed/types';

const done = () => revalidatePath('/owed', 'layout');
const can = (role: Role, allowed: Role[]) => allowed.includes(role);

export async function setRole(formData: FormData) {
  const r = String(formData.get('role')) as Role;
  if (!ROLES.includes(r)) return;
  (await cookies()).set('owed_role', r, { path: '/', maxAge: 60 * 60 * 24 * 30, sameSite: 'lax' });
  done();
}

export async function resetDemo() {
  const db = owedDb();
  if (db) await db.reset();
  else (globalThis as any).__owedMem = undefined;
  done();
}

/** Human review: confirm, reclassify, or set the batch from a label photo (→ level A). Audit-logged. */
export async function reviewCase(formData: FormData) {
  const { store, role } = await owedContext();
  if (!can(role, ['quality', 'service', 'buyer'])) return;
  const id = String(formData.get('id'));
  const action = String(formData.get('action')); // confirm | reclassify | label | request_label
  const c = (await store.cases()).find(x => x.id === id);
  if (!c) return;
  const settings = await store.settings();

  if (action === 'request_label') {
    c.labelRequestedAt = new Date().toISOString();
    if (c.status === 'analytics_only') c.status = 'awaiting_label';
    await store.saveCase(c);
    await store.audit({ at: c.labelRequestedAt, actor: role, action: 'case.label_requested', entityId: id });
    return done();
  }
  if (action === 'label') {
    const code = String(formData.get('batch') ?? '').trim();
    const a = attributeCase({ batches: await store.batches() }, { sku: c.sku, labelBatchCode: code });
    if (!a.batch) return redirect(`/owed/review?error=${encodeURIComponent(code || '—')}`);
    c.batchId = a.batch.id; c.supplierId = a.batch.supplierId; c.attribution = 'label'; c.level = 'A'; c.candidateSupplierIds = undefined;
    if (c.sku === 'не указан') c.sku = a.batch.sku;
  }
  if (action === 'reclassify') {
    const cls = formData.get('class') as DefectClass | null;
    if (cls) { c.reasoning = `Reclassified by ${role} (agent said: ${c.defectClass})`; c.defectClass = cls; }
  }
  const d = decide({ defectClass: c.defectClass, confidence: 1, attribution: c.attribution, level: c.level, hasBatch: !!c.batchId, threshold: settings.confidenceThreshold });
  c.confidence = action === 'confirm' || action === 'reclassify' ? 1 : c.confidence;
  c.recoverable = d.recoverable;
  c.needsReview = false;
  c.reviewReasons = d.reviewReasons.filter(r => !r.startsWith('low confidence'));
  c.status = d.status;
  await store.saveCase(c);
  await store.audit({ at: new Date().toISOString(), actor: role, action: `case.${action}`, entityId: id, details: { class: c.defectClass, level: c.level, status: c.status } });
  done();
}

/** Build a claim draft from the evidence registry; letters are written right away (model, or the template). */
export async function buildClaim(formData: FormData) {
  loadRootEnv();
  const { store, role, nowIso } = await owedContext();
  if (!can(role, ['buyer', 'quality'])) return redirect('/owed/claims?error=role');
  const code = String(formData.get('supplier'));
  const from = String(formData.get('from'));
  const to = String(formData.get('to'));
  const [suppliers, contracts, batches, cases, deliveries, claims] = await Promise.all([store.suppliers(), store.contracts(), store.batches(), store.cases(), store.deliveries(), store.claims()]);
  const supplier = suppliers.find(s => s.code === code);
  if (!supplier) return redirect('/owed/claims?error=supplier');
  const contract = contracts.find(c => c.id === supplier.contractId);
  const year = nowIso.slice(0, 4);
  const n = claims.filter(c => c.number.startsWith(`CL-${year}-`)).map(c => Number(c.number.split('-')[2])).reduce((a, b) => Math.max(a, b), 0) + 1;
  const claim = assembleClaim({ supplier, contract, batches, cases, deliveries, period: { from, to }, number: `CL-${year}-${String(n).padStart(3, '0')}`, nowIso, claims });
  if (!claim) return redirect(`/owed/claims?supplier=${code}&error=nothing`);
  let client;
  try { if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) client = await getModelClient(); } catch { /* template */ }
  claim.letters = await writeClaimLetters(client, claim, supplier);
  await store.saveClaim(claim);
  for (const id of claim.caseIds) {
    const c = cases.find(x => x.id === id);
    if (c) { c.claimId = claim.id; await store.saveCase(c); }
  }
  await store.audit({ at: nowIso, actor: role, action: 'claim.drafted', entityId: claim.id, details: { supplier: code, amount: claim.amount, cases: claim.caseIds.length, letters: claim.letters.source } });
  done();
  redirect(`/owed/claims?open=${claim.id}`);
}

/** Lifecycle move: draft → reviewed → sent → acknowledged/disputed → paid / legal. Roles enforced in the engine. */
export async function claimAction(formData: FormData) {
  const { store, role, nowIso } = await owedContext();
  const id = String(formData.get('id'));
  const to = String(formData.get('to')) as ClaimStatus;
  const note = String(formData.get('note') ?? '').trim() || undefined;
  const paid = formData.get('paid') ? Number(String(formData.get('paid')).replace(',', '.')) : undefined;
  const [claims, suppliers, contracts, cases] = await Promise.all([store.claims(), store.suppliers(), store.contracts(), store.cases()]);
  const claim = claims.find(c => c.id === id);
  if (!claim) return;
  const sup = suppliers.find(s => s.id === claim.supplierId)!;
  const terms = termsOf(sup, contracts.find(c => c.id === sup.contractId));
  let next;
  try {
    next = moveClaim(claim, to, role, nowIso, { note, paidAmount: paid, responseDays: terms.claimResponseDays });
  } catch (e: any) {
    return redirect(`/owed/claims?open=${id}&error=${encodeURIComponent(e.message)}`);
  }
  await store.saveClaim(next);
  // cases follow the claim
  const caseStatus = to === 'sent' ? 'claimed' : to === 'acknowledged' ? 'offered' : to === 'paid' ? 'recovered' : to === 'withdrawn' ? 'evidenced' : undefined;
  if (caseStatus) {
    for (const cid of next.caseIds) {
      const c = cases.find(x => x.id === cid);
      if (!c) continue;
      c.status = caseStatus as any;
      if (to === 'withdrawn') c.claimId = undefined;
      await store.saveCase(c);
    }
  }
  await store.audit({ at: nowIso, actor: role, action: `claim.${to}`, entityId: id, details: { number: claim.number, amount: paid ?? claim.amount, note } });
  done();
  redirect(`/owed/claims?open=${id}`);
}

/** AI contract analysis: the agent proposes clauses, code verifies the quotes, a person confirms. */
export async function analyseContract(formData: FormData) {
  loadRootEnv();
  const { store, role, nowIso } = await owedContext();
  const id = String(formData.get('id'));
  if (!can(role, ['buyer', 'management'])) return redirect(`/owed/contracts?c=${id}&error=role`);
  const ct = (await store.contracts()).find(c => c.id === id);
  if (!ct) return;
  let res;
  try {
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) throw new Error('No model key on the server');
    res = await extractContract(await getModelClient(), ct);
  } catch (e: any) {
    return redirect(`/owed/contracts?c=${id}&error=${encodeURIComponent(e.message)}`);
  }
  const keep = ct.clauses.filter(c => c.confirmed);
  const fresh = res.accepted.filter(n => !keep.some(k => k.ref === n.ref && k.topic === n.topic));
  ct.clauses = [...keep, ...fresh];
  await store.saveContract(ct);
  await store.audit({ at: nowIso, actor: 'agent', action: 'contract.analysed', entityId: id, details: { accepted: fresh.length, rejected: res.rejected } });
  done();
  redirect(`/owed/contracts?c=${id}&rejected=${res.rejected.length}`);
}

export async function clauseAction(formData: FormData) {
  const { store, role, nowIso } = await owedContext();
  if (!can(role, ['buyer', 'management'])) return;
  const id = String(formData.get('id'));
  const ref = String(formData.get('ref'));
  const topic = String(formData.get('topic'));
  const op = String(formData.get('op')); // confirm | drop
  const ct = (await store.contracts()).find(c => c.id === id);
  if (!ct) return;
  ct.clauses = op === 'drop'
    ? ct.clauses.filter(c => !(c.ref === ref && c.topic === topic))
    : ct.clauses.map(c => (c.ref === ref && c.topic === topic ? { ...c, confirmed: true, extractedBy: c.extractedBy === 'agent' ? 'agent' : 'person' } : c));
  await store.saveContract(ct);
  await store.audit({ at: nowIso, actor: role, action: `contract.clause_${op}`, entityId: id, details: { ref, topic } });
  done();
}

export async function saveWeights(formData: FormData) {
  const { store, role, nowIso } = await owedContext();
  if (role !== 'management') return;
  const s = await store.settings();
  const num = (k: string, d: number) => { const v = Number(formData.get(k)); return Number.isFinite(v) && v >= 0 && v <= 100 ? v : d; };
  const next = {
    ...s,
    weights: { quality: num('quality', s.weights.quality), delivery: num('delivery', s.weights.delivery), claims: num('claims', s.weights.claims), response: num('response', s.weights.response) },
    bands: { control: num('control', s.bands.control), priority: num('priority', s.bands.priority) },
  };
  await store.saveSettings(next);
  await store.audit({ at: nowIso, actor: role, action: 'settings.weights', details: next.weights });
  done();
}

/* back-compat: the old pack approval button */
export async function approvePack() { done(); }
