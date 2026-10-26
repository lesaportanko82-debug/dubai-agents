'use server';
import { revalidatePath } from 'next/cache';
import { panelContext, demoNow, getDomovoyDb, resetDemoHousehold, DEMO_HOUSEHOLD_NAME } from '@/lib/domovoy-server';
import { decideApproval } from '@core/domovoy/approvals';
import { refundPayment, editWallet } from '@core/domovoy/payments';
import { cartCancel, cartPaid } from '@core/domovoy/shopping';
import { rememberFact } from '@core/domovoy/profile';
import { runDemo, type DemoKind } from '@core/domovoy/demo';
import { flushOutbox, telegramSender } from '@core/domovoy/telegram';
import type { DomovoyStore } from '@core/domovoy/store';

/** Panel actions act as the logged-in member; in the in-memory demo as the first admin. */
async function who() {
  const ctx = await panelContext();
  const members = await ctx.store.members();
  const me = ctx.member ?? members.find(m => m.isAdmin) ?? members[0];
  return { store: ctx.store, me, members };
}

/** Messages produced by a panel action still reach linked Telegram chats. */
async function flush(store: DomovoyStore) {
  const tok = process.env.DOMOVOY_TELEGRAM_TOKEN?.trim();
  if (tok) await flushOutbox(store, telegramSender(tok)).catch(() => undefined);
}

export async function decideAction(formData: FormData) {
  const { store, me } = await who();
  const id = String(formData.get('approvalId'));
  const decision = String(formData.get('decision')) === 'approve' ? 'approve' : 'reject';
  try { await decideApproval(store, id, me.id, decision, demoNow()); } catch { /* stale click */ }
  await flush(store);
  revalidatePath('/domovoy', 'layout');
}

export async function refundAction(formData: FormData) {
  const { store, me } = await who();
  try { await refundPayment(store, String(formData.get('paymentId')), me.id, demoNow()); } catch { /* ignore */ }
  await flush(store);
  revalidatePath('/domovoy', 'layout');
}

export async function cartAction(formData: FormData) {
  const { store, me } = await who();
  const id = String(formData.get('cartId'));
  const op = String(formData.get('op'));
  try { if (op === 'paid') await cartPaid(store, id, me.id, demoNow()); else if (op === 'cancel') await cartCancel(store, id, me.id, demoNow()); } catch { /* ignore */ }
  await flush(store);
  revalidatePath('/domovoy', 'layout');
}

export async function walletAction(formData: FormData) {
  const { store, me } = await who();
  if (!me.isAdmin) return;
  const sub = String(formData.get('sub'));
  const value = String(formData.get('value') ?? '').trim();
  if (!value) return;
  try {
    await editWallet(store, sub, value, me.lang);
    if (sub === 'address') await rememberFact(store, me, { key: 'home', value, kind: 'place', access: 'family' }, demoNow());
  } catch { /* ignore */ }
  revalidatePath('/domovoy', 'layout');
}

export async function factAction(formData: FormData) {
  const { store, me, members } = await who();
  const key = String(formData.get('key') ?? '').trim().toLowerCase();
  const value = String(formData.get('value') ?? '').trim();
  if (!key || !value) return;
  const about = key.includes(':') ? members.find(m => m.id === key.split(':')[1])?.id : undefined;
  try { await rememberFact(store, me, { key, value, aboutMemberId: about }, demoNow()); } catch { /* not allowed / bad key */ }
  revalidatePath('/domovoy', 'layout');
}

export async function forgetAction(formData: FormData) {
  const { store, me } = await who();
  if (!me.isAdmin) return;
  await store.deleteFact(String(formData.get('key')));
  revalidatePath('/domovoy', 'layout');
}

export async function demoAction(formData: FormData) {
  const { store, me } = await who();
  if (!me.isAdmin) return;
  const kind = String(formData.get('kind')) as DemoKind;
  if (!['rain', 'heat', 'storm', 'pay', 'cart'].includes(kind)) return;
  try { await runDemo(store, me, kind, demoNow()); } catch { /* shown in the log */ }
  await flush(store);
  revalidatePath('/domovoy', 'layout');
}

export async function resetDemoAction() {
  const ctx = await panelContext();
  const db = getDomovoyDb();
  if (!db || !ctx.household || ctx.household.name !== DEMO_HOUSEHOLD_NAME) return;
  await resetDemoHousehold(db);
  revalidatePath('/domovoy', 'layout');
}
