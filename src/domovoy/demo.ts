/**
 * Showcase scenarios — the same code behind the bot's /demo command and the panel's demo buttons.
 * Everything runs through the real agent paths (autonomy, payments, shopping); only the weather is synthetic.
 */
import type { DomovoyStore } from './store';
import type { Member } from './types';
import { demoWeather, type DemoWeatherKind } from './integrations';
import { runAutonomy, isOutdoor } from './autonomy';
import { randomUUID } from 'node:crypto';
import { editWallet, placeOrder } from './payments';
import { prepareCart } from './shopping';
import { rememberFact } from './profile';

export type DemoKind = DemoWeatherKind | 'pay' | 'cart';
export const DEMO_ADDRESS = 'Dubai Marina, Marina Gate 1, apt 1204';

async function ensureAddress(store: DomovoyStore, me: Member, nowIso: string) {
  const w = await store.wallet();
  if (w.deliveryAddress) return;
  await editWallet(store, 'address', DEMO_ADDRESS, me.lang);
  try { await rememberFact(store, me, { key: 'home', value: DEMO_ADDRESS, kind: 'place', access: 'family' }, nowIso); } catch { /* exists */ }
}

/** The rain showcase needs an outdoor plan inside the rain window: a child's football 4 h from now, driven by a parent. */
async function ensureOutdoorPlan(store: DomovoyStore, me: Member, nowIso: string) {
  const [tasks, members] = await Promise.all([store.tasks(), store.members()]);
  // the synthetic rain falls in the +3h…+9h slots; a plan counts only if it lands inside them
  const from = new Date(new Date(nowIso).getTime() + 3 * 3_600_000).toISOString();
  const to = new Date(new Date(nowIso).getTime() + 9 * 3_600_000).toISOString();
  if (tasks.some(t => ['new', 'assigned', 'accepted'].includes(t.status) && t.dueAt && t.dueAt >= from && t.dueAt < to && isOutdoor(t))) return;
  const child = members.find(m => m.role === 'child');
  const driver = members.find(m => m.isAdmin && m.id !== me.id && m.skills.includes('drive')) ?? members.find(m => m.skills.includes('drive')) ?? me;
  const dueAt = new Date(new Date(nowIso).getTime() + 4 * 3_600_000).toISOString();
  const text = me.lang === 'ru' ? `Футбол: отвезти ${child?.name ?? 'ребёнка'} на тренировку` : `Football: take ${child?.name ?? 'the kid'} to practice`;
  await store.saveTask({
    id: 't-' + randomUUID().slice(0, 8), authorId: me.id, text, dueAt, minutes: 50, skills: ['drive'], kidSafe: false,
    candidateIds: [driver.id], declinedBy: [], status: 'accepted', assigneeId: driver.id, assignedAt: nowIso, reminderLevel: 0, createdAt: nowIso,
    aboutMemberId: child?.id, assignReason: 'demo: outdoor plan for the weather scenario',
  });
}

/** Run one showcase scenario as `me` (an admin). Returns a short human line. */
export async function runDemo(store: DomovoyStore, me: Member, kind: DemoKind, nowIso: string): Promise<{ ru: string; en: string }> {
  if (kind === 'pay') {
    await ensureAddress(store, me, nowIso);
    const w = await store.wallet();
    if (!w.knownMerchants.some(m => m.name === 'Carrefour')) { w.knownMerchants.push({ name: 'Carrefour', category: 'grocery', agentCheckout: true }); await store.saveWallet(w); }
    const small = Math.max(1, Math.round(w.perTxLimit / 6));
    const big = Math.round(w.perTxLimit * 3.3);
    const r1 = await placeOrder(store, { requestedBy: me.id, merchant: 'Carrefour', category: 'grocery', amount: small, items: me.lang === 'ru' ? 'Молоко 2 л, хлеб' : 'Milk 2 l, bread' }, nowIso);
    const bikeText = me.lang === 'ru' ? 'Детский велосипед' : 'Kids bike';
    const already = (await store.payments()).find(p => p.status === 'pending_approval' && p.items === bikeText);
    const r2 = already
      ? { outcome: 'pending_approval' as const, payment: already }
      : await placeOrder(store, { requestedBy: me.id, merchant: 'Carrefour', category: 'kids', amount: big, items: bikeText }, nowIso);
    return {
      ru: `🎬 Оплата: «${r1.payment.items}» → ${r1.outcome} (${r1.payment.reason.ru}); «${r2.payment.items}» → ${r2.outcome} (${r2.payment.reason.ru}). Чек с кнопкой возврата — в кошельке, одобрение — в решениях.`,
      en: `🎬 Payment: "${r1.payment.items}" → ${r1.outcome} (${r1.payment.reason.en}); "${r2.payment.items}" → ${r2.outcome} (${r2.payment.reason.en}). Receipt with refund in the wallet, approval in decisions.`,
    };
  }
  if (kind === 'cart') {
    await ensureAddress(store, me, nowIso);
    const r = await prepareCart(store, { requestedBy: me.id, merchant: 'Carrefour', category: 'grocery', items: me.lang === 'ru'
      ? [{ text: 'Молоко 2 л', est_price: 12 }, { text: 'Хлеб', est_price: 6 }, { text: 'Яйца 12 шт', est_price: 18 }, { text: 'Бананы 1 кг', est_price: 8 }]
      : [{ text: 'Milk 2 l', est_price: 12 }, { text: 'Bread', est_price: 6 }, { text: 'Eggs 12', est_price: 18 }, { text: 'Bananas 1 kg', est_price: 8 }] }, nowIso);
    return {
      ru: `🎬 Корзина Carrefour: ${r.cart.lines.length} позиции ≈ ${r.cart.estimatedTotal} ${r.cart.currency}, отправлена плательщику. Нажмите «оплатил(а)» — агент поведёт доставку до конца.`,
      en: `🎬 Carrefour cart: ${r.cart.lines.length} items ≈ ${r.cart.estimatedTotal} ${r.cart.currency}, sent to the payer. Press "paid" to watch the agent follow the delivery.`,
    };
  }
  if (kind === 'rain' || kind === 'storm') await ensureOutdoorPlan(store, me, nowIso);
  const sent = await runAutonomy(store, nowIso, { weather: demoWeather(kind, nowIso), force: true });
  const kinds = Array.from(new Set(sent.map(x => x.kind))).join(', ') || '—';
  return {
    ru: `🎬 Погода «${kind}»: агент выполнил ${sent.length} действ${sent.length === 1 ? 'ие' : sent.length < 5 ? 'ия' : 'ий'}: ${kinds}.${sent.length === 0 ? ' Для конфликта нужно дело на улице в ближайшие 12 часов (например «Отвезти Тимура на футбол в 15:00»).' : ''}`,
    en: `🎬 Weather "${kind}": the agent took ${sent.length} action${sent.length === 1 ? '' : 's'}: ${kinds}.${sent.length === 0 ? ' A conflict needs an outdoor task within 12 hours (e.g. "Take Timur to football at 15:00").' : ''}`,
  };
}
