'use server';
import { revalidatePath } from 'next/cache';
import { owedState } from '@/lib/owed-server';
import type { DefectClass } from '@core/owed/types';
import { decide } from '@core/owed/tools/decide';

/** Human review: confirm or reclassify a case. Audit-logged. */
export async function reviewCase(formData: FormData) {
  const id = String(formData.get('id'));
  const action = String(formData.get('action')); // confirm | reclassify
  const cls = formData.get('class') as DefectClass | null;
  const { store } = owedState();
  const c = (await store.cases()).find(x => x.id === id);
  if (!c) return;

  if (action === 'reclassify' && cls) {
    const was = c.defectClass;
    c.defectClass = cls;
    c.confidence = 1;
    c.reasoning = `Reclassified by reviewer (agent said: ${was})`;
  }
  const d = decide({ defectClass: c.defectClass, confidence: 1, attribution: c.attribution === 'sku_latest_batch_guess' ? 'manual' : c.attribution, hasBatch: !!c.batchId });
  c.attribution = c.attribution === 'sku_latest_batch_guess' ? 'manual' : c.attribution;
  c.recoverable = d.recoverable;
  c.needsReview = false;
  c.reviewReasons = [];
  c.status = d.status;
  await store.saveCase(c);
  await store.audit({ at: new Date().toISOString(), actor: 'reviewer', action: `case.${action}`, entityId: id, details: { class: c.defectClass, status: c.status } });
  revalidatePath('/owed', 'layout');
}

export async function approvePack(formData: FormData) {
  const id = String(formData.get('id'));
  const { store } = owedState();
  const pack = store.packs().find(p => p.id === id);
  if (!pack) return;
  pack.status = 'approved';
  const cases = await store.cases();
  for (const cid of pack.caseIds) {
    const c = cases.find(x => x.id === cid);
    if (c && c.status === 'evidenced') { c.status = 'claimed'; await store.saveCase(c); }
  }
  await store.audit({ at: new Date().toISOString(), actor: 'approver', action: 'pack.approved', entityId: id, details: { amount: pack.amount } });
  revalidatePath('/owed', 'layout');
}
