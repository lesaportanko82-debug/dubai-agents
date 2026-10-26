/**
 * Shopping, level 1: the agent builds the cart, a person taps "pay" in the merchant's own app.
 *
 * No merchant has an agent API we may use today, and automating someone's shop account breaks
 * the shop's rules and the family's privacy. So the honest chain is:
 *   build the cart (items, estimated total, the family's delivery address, a deep link that opens
 *   the merchant search / app) → send it to the person who will pay → they tap once in the app →
 *   tell the agent "paid" → the agent creates "receive the delivery", verifies it arrived, reports.
 * If the merchant accepts agent checkout (wallet.knownMerchants[].agentCheckout — the Stripe sandbox
 * demo), the same card offers "pay from the family wallet" and the rules in payments.ts apply.
 */
import { randomUUID } from 'node:crypto';
import type { DomovoyStore } from './store';
import type { Lang, Member, Task } from './types';
import { formatMoney, type Currency } from './policy';
import { placeOrder, type OrderOutcome, type PaymentCategory } from './payments';
import { homeAddress } from './profile';
import { rankCandidates } from './tools/assign';
import { assignTask, buildContext } from './household';

export interface MerchantInfo { name: string; category: PaymentCategory; country: string; search: (q: string) => string; home: string; note?: string }

/** UAE merchants with public search deep links. The link opens the shop's search for a line item. */
export const MERCHANTS: MerchantInfo[] = [
  { name: 'Carrefour', category: 'grocery', country: 'AE', home: 'https://www.carrefouruae.com', search: q => `https://www.carrefouruae.com/mafuae/en/search?keyword=${encodeURIComponent(q)}` },
  { name: 'Noon', category: 'household', country: 'AE', home: 'https://www.noon.com/uae-en/', search: q => `https://www.noon.com/uae-en/search/?q=${encodeURIComponent(q)}` },
  { name: 'Amazon.ae', category: 'household', country: 'AE', home: 'https://www.amazon.ae', search: q => `https://www.amazon.ae/s?k=${encodeURIComponent(q)}` },
  { name: 'Talabat', category: 'food_delivery', country: 'AE', home: 'https://www.talabat.com/uae', search: q => `https://www.talabat.com/uae/search?q=${encodeURIComponent(q)}` },
  { name: 'InstaShop', category: 'grocery', country: 'AE', home: 'https://instashop.com', search: q => `https://instashop.com/en-ae/search?q=${encodeURIComponent(q)}` },
  { name: 'Kibsons', category: 'grocery', country: 'AE', home: 'https://www.kibsons.com', search: q => `https://www.kibsons.com/search?q=${encodeURIComponent(q)}` },
  { name: 'Life Pharmacy', category: 'pharmacy', country: 'AE', home: 'https://www.lifepharmacy.com', search: q => `https://www.lifepharmacy.com/search?q=${encodeURIComponent(q)}` },
  { name: 'Careem', category: 'food_delivery', country: 'AE', home: 'https://www.careem.com', search: q => `https://www.careem.com/?q=${encodeURIComponent(q)}`, note: 'app' },
];

export function findMerchant(name: string): MerchantInfo | undefined {
  const n = name.trim().toLowerCase();
  return MERCHANTS.find(m => m.name.toLowerCase() === n || m.name.toLowerCase().startsWith(n) || n.startsWith(m.name.toLowerCase()));
}

export interface CartLine { text: string; qty?: number; estPrice?: number; link?: string }
export type CartStatus = 'sent' | 'paid_by_human' | 'paid_by_wallet' | 'delivered' | 'cancelled';

export interface Cart {
  id: string;
  householdId: string;
  requestedBy: string;
  payerId: string;               // who gets the card: the requester if an adult, else an admin
  merchant: string;
  category: PaymentCategory;
  lines: CartLine[];
  estimatedTotal: number;
  currency: Currency;
  deliveryAddress?: string;
  homeUrl: string;
  status: CartStatus;
  createdAt: string;
  paidAt?: string;
  receiveTaskId?: string;        // the agent-managed "receive the delivery" task
  taskId?: string;
  note?: string;
}

const say = (lang: Lang, ru: string, en: string) => (lang === 'ru' ? ru : en);
const plus = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();

export interface CartRequest { requestedBy: string; merchant: string; category?: PaymentCategory; items: { text: string; qty?: number; est_price?: number }[]; taskId?: string }

/** Build and send the cart card. Returns the cart and whether the wallet can pay it directly. */
export async function prepareCart(store: DomovoyStore, req: CartRequest, nowIso: string): Promise<{ cart: Cart; walletEligible: boolean; outcome: 'sent' }> {
  const [members, wallet] = await Promise.all([store.members(), store.wallet()]);
  const me = members.find(m => m.id === req.requestedBy);
  if (!me) throw new Error('unknown requester');
  const info = findMerchant(req.merchant);
  const merchant = info?.name ?? req.merchant.trim();
  const category = req.category ?? info?.category ?? 'other';
  const lines: CartLine[] = req.items.slice(0, 20).map(i => ({ text: i.text.trim(), qty: i.qty, estPrice: i.est_price, link: info?.search(i.text.trim()) }));
  const estimatedTotal = Math.round(lines.reduce((s, l) => s + (l.estPrice ?? 0) * (l.qty ?? 1), 0));
  const address = wallet.deliveryAddress ?? (await homeAddress(store));
  // a child or helper never pays: the card goes to an admin (the first one), the requester is told
  const payer = me.role === 'child' || me.role === 'helper' ? (members.find(m => m.isAdmin) ?? me) : me;
  const cart: Cart = {
    id: 'cart-' + randomUUID().slice(0, 8), householdId: store.householdId, requestedBy: me.id, payerId: payer.id,
    merchant, category, lines, estimatedTotal, currency: wallet.currency, deliveryAddress: address,
    homeUrl: info?.home ?? `https://www.google.com/search?q=${encodeURIComponent(merchant)}`,
    status: 'sent', createdAt: nowIso, taskId: req.taskId,
  };
  await store.saveCart(cart);
  await store.event({ at: nowIso, taskId: cart.taskId ?? cart.id, actor: 'agent', type: 'info', details: { kind: 'cart_sent', cartId: cart.id, merchant, lines: lines.length, estimatedTotal } });
  const walletEligible = !!wallet.knownMerchants.find(m => m.name.toLowerCase() === merchant.toLowerCase() && m.agentCheckout);
  await store.send({ at: nowIso, toId: payer.id, lang: payer.lang, kind: 'cart', cartId: cart.id, taskId: cart.taskId, text: formatCart(cart, members, payer.lang, walletEligible) });
  if (payer.id !== me.id) {
    await store.send({ at: nowIso, toId: me.id, lang: me.lang, kind: 'info', text: say(me.lang, `🛒 Собрал корзину «${lines.map(l => l.text).join(', ')}» в ${merchant} и отправил ${payer.name} — оплатить может только взрослый.`, `🛒 Built the cart "${lines.map(l => l.text).join(', ')}" at ${merchant} and sent it to ${payer.name} — only an adult can pay.`) });
  }
  return { cart, walletEligible, outcome: 'sent' };
}

export function formatCart(c: Cart, members: Member[], lang: Lang, walletEligible: boolean): string {
  const who = members.find(m => m.id === c.requestedBy)?.name ?? c.requestedBy;
  const items = c.lines.map(l => `• ${l.text}${l.qty && l.qty > 1 ? ` ×${l.qty}` : ''}${l.estPrice ? ` ≈ ${formatMoney(l.estPrice * (l.qty ?? 1), c.currency)}` : ''}`).join('\n');
  const total = c.estimatedTotal ? (lang === 'ru' ? `\nИтого ≈ ${formatMoney(c.estimatedTotal, c.currency)}` : `\nTotal ≈ ${formatMoney(c.estimatedTotal, c.currency)}`) : '';
  return lang === 'ru'
    ? `🛒 Корзина ${c.merchant}${who !== members.find(m => m.id === c.payerId)?.name ? ` (просит ${who})` : ''}:\n${items}${total}\nДоставка: ${c.deliveryAddress ?? 'адрес не задан — /wallet address …'}\n\nОткройте магазин, добавьте позиции (ссылки на поиск ниже) и оплатите одним тапом. Потом нажмите «оплатил» — я прослежу за доставкой.${walletEligible ? '\nИли нажмите «из кошелька семьи» — оплачу сам по правилам.' : ''}`
    : `🛒 ${c.merchant} cart${who !== members.find(m => m.id === c.payerId)?.name ? ` (requested by ${who})` : ''}:\n${items}${total}\nDelivery: ${c.deliveryAddress ?? 'address not set — /wallet address …'}\n\nOpen the shop, add the items (search links below) and pay with one tap. Then press "paid" — I will follow the delivery.${walletEligible ? '\nOr press "from the family wallet" — I pay within the rules.' : ''}`;
}

/** A person paid in the merchant app → the agent owns the rest: a "receive the delivery" task, verification, report. */
export async function cartPaid(store: DomovoyStore, cartId: string, byId: string, nowIso: string, how: 'human' | 'wallet' = 'human'): Promise<{ ok: boolean; cart?: Cart; note: { ru: string; en: string } }> {
  const cart = (await store.carts()).find(c => c.id === cartId);
  if (!cart) return { ok: false, note: { ru: 'Корзина не найдена.', en: 'Cart not found.' } };
  const members = await store.members();
  const by = members.find(m => m.id === byId);
  if (!by || !(by.isAdmin || by.id === cart.payerId)) return { ok: false, cart, note: { ru: 'Отметить оплату может плательщик или администратор.', en: 'Only the payer or an admin can mark it paid.' } };
  if (cart.status !== 'sent') return { ok: false, cart, note: { ru: `Корзина уже ${cart.status}.`, en: `Cart is already ${cart.status}.` } };
  cart.status = how === 'wallet' ? 'paid_by_wallet' : 'paid_by_human'; cart.paidAt = nowIso;

  // record the spend so /impact and the monthly cap see it (human checkout → provider 'human')
  if (how === 'human') {
    await store.savePayment({
      id: 'pay-' + randomUUID().slice(0, 8), householdId: store.householdId, requestedBy: cart.requestedBy, merchant: cart.merchant, category: cart.category,
      items: cart.lines.map(l => l.text).join(', '), amount: cart.estimatedTotal, currency: cart.currency, amountInWallet: cart.estimatedTotal,
      status: 'paid', reason: { ru: 'оплачено человеком в приложении магазина', en: 'paid by a person in the merchant app' }, rule: 'human_checkout',
      providerRef: 'human:' + by.id, createdAt: nowIso, paidAt: nowIso, taskId: cart.taskId,
    });
  }
  // "receive the delivery" → whoever is home; agent-managed so verification + loop-closed report apply
  const t: Task = {
    id: 't-' + randomUUID().slice(0, 8), authorId: cart.requestedBy, text: say(store.lang, `Принять доставку ${cart.merchant}`, `Receive the ${cart.merchant} delivery`),
    minutes: 10, skills: [], kidSafe: false, candidateIds: [], declinedBy: [], status: 'new', reminderLevel: 0, createdAt: nowIso,
    origin: 'followup', agentManaged: true, verifyAt: plus(nowIso, 120), dueAt: plus(nowIso, 90), place: cart.deliveryAddress,
  };
  const ctx = await buildContext(store, nowIso); ctx.existingTasks = await store.tasks();
  const { allowed } = rankCandidates(members, t, ctx);
  t.candidateIds = allowed.map(c => c.memberId);
  await store.saveTask(t);
  await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'created', details: { text: t.text, origin: 'followup', cartId: cart.id } });
  const pick = t.candidateIds.includes(by.id) ? by.id : t.candidateIds[0];
  if (pick) await assignTask(store, t, pick, 'delivery follow-up', nowIso, say(members.find(m => m.id === pick)!.lang, `📦 ${cart.merchant} едет на ${cart.deliveryAddress ?? 'дом'} (${cart.lines.length} поз.). Напишите «готово», когда примете — я закрою заказ.`, `📦 ${cart.merchant} is on its way to ${cart.deliveryAddress ?? 'home'} (${cart.lines.length} items). Say "done" when received — I will close the order.`));
  else t.status = 'unassigned';
  cart.receiveTaskId = t.id;
  await store.saveCart(cart);
  await store.event({ at: nowIso, taskId: cart.taskId ?? cart.id, actor: by.id, type: 'info', details: { kind: 'cart_paid', cartId: cart.id, how } });
  if (cart.requestedBy !== by.id) {
    const req = members.find(m => m.id === cart.requestedBy);
    if (req) await store.send({ at: nowIso, toId: req.id, lang: req.lang, kind: 'info', text: say(req.lang, `✅ ${by.name} оплатил(а) корзину ${cart.merchant}. Слежу за доставкой.`, `✅ ${by.name} paid the ${cart.merchant} cart. Following the delivery.`) });
  }
  return { ok: true, cart, note: { ru: `Принято. Создал «${t.text}»${pick ? ` для ${members.find(m => m.id === pick)?.name}` : ''}; через 2 часа проверю, что доставка пришла, и отчитаюсь.`, en: `Noted. Created "${t.text}"${pick ? ` for ${members.find(m => m.id === pick)?.name}` : ''}; in 2 hours I will check it arrived and report.` } };
}

/** "Pay from the family wallet" button: the payment rules decide (limits, categories, approvals). */
export async function cartPayFromWallet(store: DomovoyStore, cartId: string, byId: string, nowIso: string): Promise<{ ok: boolean; outcome?: OrderOutcome; note: { ru: string; en: string } }> {
  const cart = (await store.carts()).find(c => c.id === cartId);
  if (!cart) return { ok: false, note: { ru: 'Корзина не найдена.', en: 'Cart not found.' } };
  if (cart.status !== 'sent') return { ok: false, note: { ru: `Корзина уже ${cart.status}.`, en: `Cart is already ${cart.status}.` } };
  if (!cart.estimatedTotal) return { ok: false, note: { ru: 'В корзине нет цен — оплатите в приложении магазина.', en: 'No prices in the cart — pay in the merchant app.' } };
  const outcome = await placeOrder(store, { requestedBy: byId, merchant: cart.merchant, category: cart.category, amount: cart.estimatedTotal, currency: cart.currency, items: cart.lines.map(l => l.text).join(', '), taskId: cart.taskId }, nowIso);
  if (outcome.outcome === 'paid') await cartPaid(store, cartId, byId, nowIso, 'wallet');
  const notes: Record<OrderOutcome['outcome'], { ru: string; en: string }> = {
    paid: { ru: 'Оплатил из кошелька семьи, чек отправлен. Слежу за доставкой.', en: 'Paid from the family wallet, receipt sent. Following the delivery.' },
    pending_approval: { ru: 'Сумма вне правил — отправил родителям на одобрение.', en: 'Outside the rules — sent to the parents for approval.' },
    declined: { ru: 'Правила семьи запрещают эту категорию.', en: 'The family rules block this category.' },
    card_declined: { ru: 'Банк отклонил карту, ничего не списано.', en: 'The bank declined the card, nothing charged.' },
    need_address: { ru: 'Нет адреса доставки — задайте: /wallet address …', en: 'No delivery address — set it: /wallet address …' },
  };
  return { ok: outcome.outcome === 'paid', outcome, note: notes[outcome.outcome] };
}

export async function cartCancel(store: DomovoyStore, cartId: string, byId: string, nowIso: string): Promise<{ ok: boolean; note: { ru: string; en: string } }> {
  const cart = (await store.carts()).find(c => c.id === cartId);
  if (!cart) return { ok: false, note: { ru: 'Корзина не найдена.', en: 'Cart not found.' } };
  if (cart.status !== 'sent') return { ok: false, note: { ru: `Корзина уже ${cart.status}.`, en: `Cart is already ${cart.status}.` } };
  cart.status = 'cancelled';
  await store.saveCart(cart);
  await store.event({ at: nowIso, taskId: cart.taskId ?? cart.id, actor: byId, type: 'info', details: { kind: 'cart_cancelled', cartId: cart.id } });
  const members = await store.members();
  const req = members.find(m => m.id === cart.requestedBy);
  if (req && req.id !== byId) await store.send({ at: nowIso, toId: req.id, lang: req.lang, kind: 'info', text: say(req.lang, `❌ Корзину ${cart.merchant} не оплатили — «${cart.lines.map(l => l.text).join(', ')}» отменено.`, `❌ The ${cart.merchant} cart was not paid — "${cart.lines.map(l => l.text).join(', ')}" cancelled.`) });
  return { ok: true, note: { ru: 'Отменил корзину.', en: 'Cart cancelled.' } };
}
