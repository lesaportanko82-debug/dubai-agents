/**
 * Payments with rules — the agent can order things, but inside a wallet policy the family controls.
 *
 * Two layers of defence, both auditable:
 *  1. Wallet policy (this file): per-transaction limit, monthly cap, allowed / blocked categories,
 *     known merchants, what children may order. A rule breach never spends money: it becomes a
 *     declined payment and, where it makes sense, an approval for the parents.
 *  2. The card itself. In production the same limits live on the issuer side (Stripe Issuing spending
 *     controls), so even a misbehaving agent cannot exceed them. Here the provider is Stripe in TEST
 *     mode (real API, test cards, no money) or a built-in simulator when no key is configured.
 *
 * The agent never sees a card number: it holds a provider token and a policy.
 */
import { randomUUID } from 'node:crypto';
import type { DomovoyStore } from './store';
import type { Lang, Member } from './types';
import { convert, formatMoney, parseCurrency, type Currency } from './policy';
import { requestApproval } from './approvals';
import { homeAddress } from './profile';

export type PaymentCategory = 'grocery' | 'pharmacy' | 'kids' | 'household' | 'transport' | 'food_delivery' | 'education' | 'clothes' | 'electronics' | 'entertainment' | 'subscriptions' | 'other';
export const PAYMENT_CATEGORIES: PaymentCategory[] = ['grocery', 'pharmacy', 'kids', 'household', 'transport', 'food_delivery', 'education', 'clothes', 'electronics', 'entertainment', 'subscriptions', 'other'];

export interface WalletPolicy {
  currency: Currency;
  perTxLimit: number;            // single order above this → parents
  monthlyLimit: number;          // total paid this calendar month above this → parents
  allowedCategories: PaymentCategory[];
  blockedCategories: PaymentCategory[];   // never, not even with approval (gambling-like categories are simply absent)
  childMayOrder: PaymentCategory[];       // a child may trigger these on their own (still within limits)
  knownMerchants: { name: string; category: PaymentCategory }[];  // first order at an unknown merchant → parents
  deliveryAddress?: string;
  /** provider token — never a card number. 'sim' = built-in sandbox */
  provider: 'sim' | 'stripe_test';
}

export function defaultWallet(currency: Currency): WalletPolicy {
  const perTx = { AED: 150, USD: 40, EUR: 40, GBP: 30, SAR: 150, RUB: 4000, KZT: 20000, TRY: 1500, INR: 3000, PHP: 2000, UZS: 500000, BYN: 130 }[currency];
  return {
    currency, perTxLimit: perTx, monthlyLimit: perTx * 10,
    allowedCategories: ['grocery', 'pharmacy', 'kids', 'household', 'transport', 'food_delivery', 'education'],
    blockedCategories: ['subscriptions', 'electronics', 'entertainment'],
    childMayOrder: [],
    knownMerchants: [],
    provider: process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'stripe_test' : 'sim',
  };
}

export type PaymentStatus = 'paid' | 'declined' | 'pending_approval' | 'refunded' | 'failed';

export interface Payment {
  id: string;
  householdId: string;
  requestedBy: string;
  merchant: string;
  category: PaymentCategory;
  items: string;
  amount: number;
  currency: Currency;
  amountInWallet: number;        // converted to the wallet currency, rounded
  status: PaymentStatus;
  reason: { ru: string; en: string };
  rule?: string;                 // which rule fired: per_tx_limit | monthly_limit | blocked_category | category_not_allowed | unknown_merchant | child_not_allowed | card_declined
  providerRef?: string;          // pi_… (Stripe) or sim_…
  receiptUrl?: string;
  approvalId?: string;
  overrideBy?: string;           // parent who approved past a rule
  createdAt: string;
  paidAt?: string;
  refundedAt?: string;
  taskId?: string;
}

export interface OrderRequest { requestedBy: string; merchant: string; category: PaymentCategory; amount: number; currency?: string; items: string; taskId?: string }

const say = (lang: Lang, ru: string, en: string) => (lang === 'ru' ? ru : en);

// ──────────── providers ────────────

export interface ChargeResult { ok: boolean; ref: string; receiptUrl?: string; declineCode?: string }
export interface PaymentProvider {
  name: 'sim' | 'stripe_test';
  charge(p: Payment, opts: { forceDecline?: boolean }): Promise<ChargeResult>;
  refund(ref: string): Promise<{ ok: boolean; ref: string }>;
}

/** Built-in sandbox: deterministic, no network. Mirrors the shape of a card authorisation. */
export const simProvider: PaymentProvider = {
  name: 'sim',
  async charge(p, opts) {
    if (opts.forceDecline) return { ok: false, ref: 'sim_' + randomUUID().slice(0, 10), declineCode: 'card_declined' };
    return { ok: true, ref: 'sim_' + randomUUID().slice(0, 10), receiptUrl: undefined };
  },
  async refund(ref) { return { ok: true, ref: 're_' + ref }; },
};

/** Stripe TEST mode over plain fetch: PaymentIntent confirmed with a test card, refunds, declines. */
export function stripeTestProvider(secretKey: string): PaymentProvider {
  const api = async (path: string, body: Record<string, string>) => {
    const res = await fetch('https://api.stripe.com/v1' + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const json = await res.json() as any;
    return { ok: res.ok, json };
  };
  return {
    name: 'stripe_test',
    async charge(p, opts) {
      const minor = Math.round(p.amount * 100);
      const { ok, json } = await api('/payment_intents', {
        amount: String(minor), currency: p.currency.toLowerCase(),
        'payment_method_types[]': 'card',
        payment_method: opts.forceDecline ? 'pm_card_visa_chargeDeclined' : 'pm_card_visa',
        confirm: 'true',
        description: `Domovoy · ${p.merchant} · ${p.items}`.slice(0, 200),
        'metadata[household]': p.householdId, 'metadata[payment]': p.id, 'metadata[requested_by]': p.requestedBy,
        'expand[]': 'latest_charge',
      });
      if (!ok || json.status !== 'succeeded') {
        return { ok: false, ref: json?.error?.payment_intent?.id ?? json?.id ?? 'pi_failed', declineCode: json?.error?.decline_code ?? json?.error?.code ?? json?.status ?? 'failed' };
      }
      return { ok: true, ref: json.id, receiptUrl: json.latest_charge?.receipt_url };
    },
    async refund(ref) {
      const { ok, json } = await api('/refunds', { payment_intent: ref });
      return { ok: ok && json.status !== 'failed', ref: json?.id ?? 'refund_failed' };
    },
  };
}

export function providerFor(wallet: WalletPolicy): PaymentProvider {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (wallet.provider === 'stripe_test' && key?.startsWith('sk_test_')) return stripeTestProvider(key);
  return simProvider;
}

// ──────────── rules ────────────

export function monthSpent(payments: Payment[], nowIso: string): number {
  const ym = nowIso.slice(0, 7);
  return payments.filter(p => p.status === 'paid' && (p.paidAt ?? p.createdAt).slice(0, 7) === ym).reduce((s, p) => s + p.amountInWallet, 0);
}

export interface RuleVerdict { allow: boolean; rule?: Payment['rule']; escalate: boolean; reason: { ru: string; en: string } }

/** Pure decision: can this order go through on the agent's own authority? */
export function evaluateOrder(wallet: WalletPolicy, requester: Member, req: { merchant: string; category: PaymentCategory; amountInWallet: number }, spentThisMonth: number): RuleVerdict {
  const cur = wallet.currency;
  if (wallet.blockedCategories.includes(req.category)) {
    return { allow: false, escalate: false, rule: 'blocked_category', reason: { ru: `категория «${req.category}» закрыта правилами семьи — даже с одобрением`, en: `category "${req.category}" is blocked by the family rules — even with approval` } };
  }
  if (requester.role === 'child' && !wallet.childMayOrder.includes(req.category)) {
    return { allow: false, escalate: true, rule: 'child_not_allowed', reason: { ru: `${requester.name} — ребёнок, категорию «${req.category}» дети сами не заказывают`, en: `${requester.name} is a child; children do not order "${req.category}" on their own` } };
  }
  if (!wallet.allowedCategories.includes(req.category)) {
    return { allow: false, escalate: true, rule: 'category_not_allowed', reason: { ru: `категория «${req.category}» не в списке разрешённых`, en: `category "${req.category}" is not on the allowed list` } };
  }
  if (req.amountInWallet > wallet.perTxLimit) {
    return { allow: false, escalate: true, rule: 'per_tx_limit', reason: { ru: `${formatMoney(req.amountInWallet, cur)} больше лимита на покупку ${formatMoney(wallet.perTxLimit, cur)}`, en: `${formatMoney(req.amountInWallet, cur)} exceeds the per-purchase limit ${formatMoney(wallet.perTxLimit, cur)}` } };
  }
  if (spentThisMonth + req.amountInWallet > wallet.monthlyLimit) {
    return { allow: false, escalate: true, rule: 'monthly_limit', reason: { ru: `с этой покупкой месяц выйдет за лимит ${formatMoney(wallet.monthlyLimit, cur)} (уже ${formatMoney(spentThisMonth, cur)})`, en: `this would push the month past ${formatMoney(wallet.monthlyLimit, cur)} (already ${formatMoney(spentThisMonth, cur)})` } };
  }
  const known = wallet.knownMerchants.some(m => m.name.toLowerCase() === req.merchant.toLowerCase());
  if (!known) {
    return { allow: false, escalate: true, rule: 'unknown_merchant', reason: { ru: `«${req.merchant}» — новый продавец, первый заказ подтверждают родители`, en: `"${req.merchant}" is a new merchant; the first order needs a parent` } };
  }
  return { allow: true, escalate: false, reason: { ru: 'в рамках правил семьи', en: 'within the family rules' } };
}

// ──────────── the flow ────────────

export interface OrderOutcome { payment: Payment; outcome: 'paid' | 'pending_approval' | 'declined' | 'card_declined' | 'need_address' }

/**
 * Place an order on the agent's authority. Within the rules → charge, receipt to the requester and the
 * admins with an undo (refund) button. Outside → declined payment + approval for the parents (unless the
 * category is blocked outright). Approval → chargeOverride().
 */
export async function placeOrder(store: DomovoyStore, req: OrderRequest, nowIso: string, opts: { forceDecline?: boolean } = {}): Promise<OrderOutcome> {
  const [members, payments] = await Promise.all([store.members(), store.payments()]);
  const wallet = await store.wallet();
  const me = members.find(m => m.id === req.requestedBy);
  if (!me) throw new Error('unknown requester');
  const cur = parseCurrency(req.currency) ?? wallet.currency;
  const amountInWallet = Math.round(convert(req.amount, cur, wallet.currency));
  const p: Payment = {
    id: 'pay-' + randomUUID().slice(0, 8), householdId: store.householdId, requestedBy: me.id,
    merchant: req.merchant, category: req.category, items: req.items, amount: req.amount, currency: cur, amountInWallet,
    status: 'declined', reason: { ru: '', en: '' }, createdAt: nowIso, taskId: req.taskId,
  };
  const delivery = ['grocery', 'food_delivery', 'pharmacy', 'household', 'kids', 'clothes'].includes(req.category);
  if (delivery && !wallet.deliveryAddress) {
    const home = await homeAddress(store);
    if (home) { wallet.deliveryAddress = home; await store.saveWallet(wallet); }
  }
  if (delivery && !wallet.deliveryAddress) {
    p.reason = { ru: 'нет адреса доставки — скажите его один раз (я запомню как «home»)', en: 'no delivery address yet — tell me once (I will remember it as "home")' };
    p.rule = undefined;
    await store.savePayment(p);
    return { payment: p, outcome: 'need_address' };
  }

  const verdict = evaluateOrder(wallet, me, { merchant: req.merchant, category: req.category, amountInWallet }, monthSpent(payments, nowIso));
  p.rule = verdict.rule; p.reason = verdict.reason;

  if (!verdict.allow) {
    await store.savePayment(p);
    await store.event({ at: nowIso, taskId: p.taskId ?? p.id, actor: 'agent', type: 'info', details: { kind: 'payment_declined', paymentId: p.id, rule: p.rule, amount: amountInWallet } });
    if (!verdict.escalate) {
      await store.send({ at: nowIso, toId: me.id, lang: me.lang, kind: 'info', text: say(me.lang, `🚫 Не могу: ${verdict.reason.ru}.`, `🚫 I cannot: ${verdict.reason.en}.`) });
      return { payment: p, outcome: 'declined' };
    }
    const a = await requestApproval(store, {
      action: 'spend_money',
      payload: { paymentId: p.id, amount: p.amount, currency: p.currency, purpose: `${p.merchant}: ${p.items}` },
      reason: {
        ru: `💳 ${me.name} просит заказать «${p.items}» в ${p.merchant} за ${formatMoney(p.amount, p.currency)}${cur !== wallet.currency ? ` (≈ ${formatMoney(amountInWallet, wallet.currency)})` : ''}.\nКарта отклонила: ${verdict.reason.ru}. Оплатить с вашего разрешения?`,
        en: `💳 ${me.name} asks to order "${p.items}" at ${p.merchant} for ${formatMoney(p.amount, p.currency)}${cur !== wallet.currency ? ` (≈ ${formatMoney(amountInWallet, wallet.currency)})` : ''}.\nThe card declined: ${verdict.reason.en}. Pay with your permission?`,
      },
      requestedBy: me.id, authorId: me.id, taskId: p.taskId,
    }, nowIso);
    p.status = 'pending_approval'; p.approvalId = a.id;
    await store.savePayment(p);
    await store.send({ at: nowIso, toId: me.id, lang: me.lang, kind: 'info', text: say(me.lang, `⏳ «${p.items}» — ${verdict.reason.ru}. Отправил родителям на одобрение.`, `⏳ "${p.items}" — ${verdict.reason.en}. Sent to the parents for approval.`) });
    return { payment: p, outcome: 'pending_approval' };
  }

  return charge(store, p, me, nowIso, { forceDecline: opts.forceDecline });
}

/** A parent approved a payment the rules had stopped. */
export async function chargeOverride(store: DomovoyStore, paymentId: string, decidedBy: string, nowIso: string): Promise<OrderOutcome> {
  const p = (await store.payments()).find(x => x.id === paymentId);
  if (!p) throw new Error('unknown payment');
  if (p.status !== 'pending_approval') throw new Error('payment is ' + p.status);
  const me = (await store.members()).find(m => m.id === p.requestedBy)!;
  p.overrideBy = decidedBy;
  return charge(store, p, me, nowIso, {});
}

async function charge(store: DomovoyStore, p: Payment, me: Member, nowIso: string, opts: { forceDecline?: boolean }): Promise<OrderOutcome> {
  const wallet = await store.wallet();
  const provider = providerFor(wallet);
  const res = await provider.charge(p, { forceDecline: !!opts.forceDecline });
  const members = await store.members();
  if (!res.ok) {
    p.status = 'failed'; p.rule = 'card_declined'; p.providerRef = res.ref;
    p.reason = { ru: `банк отклонил карту (${res.declineCode ?? 'declined'})`, en: `the bank declined the card (${res.declineCode ?? 'declined'})` };
    await store.savePayment(p);
    await store.event({ at: nowIso, taskId: p.taskId ?? p.id, actor: 'agent', type: 'info', details: { kind: 'payment_failed', paymentId: p.id, code: res.declineCode } });
    for (const m of new Set([me, ...members.filter(x => x.isAdmin)])) {
      await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'info', text: say(m.lang, `❌ Оплата «${p.items}» не прошла: ${p.reason.ru}. Ничего не списано.`, `❌ Payment for "${p.items}" failed: ${p.reason.en}. Nothing was charged.`) });
    }
    return { payment: p, outcome: 'card_declined' };
  }
  p.status = 'paid'; p.paidAt = nowIso; p.providerRef = res.ref; p.receiptUrl = res.receiptUrl;
  if (!p.overrideBy) p.reason = { ru: 'в рамках правил семьи', en: 'within the family rules' };
  await store.savePayment(p);
  // remember the merchant → next time it is "known"
  if (!wallet.knownMerchants.some(m => m.name.toLowerCase() === p.merchant.toLowerCase())) {
    wallet.knownMerchants.push({ name: p.merchant, category: p.category });
    await store.saveWallet(wallet);
  }
  await store.event({ at: nowIso, taskId: p.taskId ?? p.id, actor: 'agent', type: 'autonomous_action', details: { kind: 'payment', paymentId: p.id, amount: p.amountInWallet, currency: wallet.currency, override: p.overrideBy } });
  const spent = monthSpent(await store.payments(), nowIso);
  const receipt = (lang: Lang) => say(lang,
    `🧾 Оплачено: «${p.items}» · ${p.merchant} · ${formatMoney(p.amount, p.currency)}${p.currency !== wallet.currency ? ` (≈ ${formatMoney(p.amountInWallet, wallet.currency)})` : ''}\n${p.overrideBy ? `По разрешению: ${members.find(m => m.id === p.overrideBy)?.name ?? p.overrideBy}. ` : `Правило: ${p.reason.ru}. `}Доставка: ${wallet.deliveryAddress ?? '—'}.\nЗа месяц: ${formatMoney(spent, wallet.currency)} из ${formatMoney(wallet.monthlyLimit, wallet.currency)}. ${provider.name === 'stripe_test' ? 'Stripe test mode' : 'Песочница'}${p.receiptUrl ? ` · чек: ${p.receiptUrl}` : ''} · ${p.providerRef}`,
    `🧾 Paid: "${p.items}" · ${p.merchant} · ${formatMoney(p.amount, p.currency)}${p.currency !== wallet.currency ? ` (≈ ${formatMoney(p.amountInWallet, wallet.currency)})` : ''}\n${p.overrideBy ? `Approved by: ${members.find(m => m.id === p.overrideBy)?.name ?? p.overrideBy}. ` : `Rule: ${p.reason.en}. `}Delivery: ${wallet.deliveryAddress ?? '—'}.\nThis month: ${formatMoney(spent, wallet.currency)} of ${formatMoney(wallet.monthlyLimit, wallet.currency)}. ${provider.name === 'stripe_test' ? 'Stripe test mode' : 'Sandbox'}${p.receiptUrl ? ` · receipt: ${p.receiptUrl}` : ''} · ${p.providerRef}`);
  for (const m of new Set([me, ...members.filter(x => x.isAdmin)])) {
    await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'receipt', text: receipt(m.lang), taskId: p.taskId, paymentId: p.id });
  }
  return { payment: p, outcome: 'paid' };
}

/** Undo: refund a paid order (requester or admin). */
export async function refundPayment(store: DomovoyStore, paymentId: string, byId: string, nowIso: string): Promise<{ ok: boolean; payment?: Payment; note: { ru: string; en: string } }> {
  const p = (await store.payments()).find(x => x.id === paymentId);
  if (!p) return { ok: false, note: { ru: 'Платёж не найден.', en: 'Payment not found.' } };
  const members = await store.members();
  const by = members.find(m => m.id === byId);
  if (!by || !(by.isAdmin || by.id === p.requestedBy)) return { ok: false, payment: p, note: { ru: 'Возврат может сделать автор заказа или администратор.', en: 'Only the requester or an admin can refund.' } };
  if (p.status !== 'paid') return { ok: false, payment: p, note: { ru: `Платёж уже ${p.status}.`, en: `Payment is already ${p.status}.` } };
  const wallet = await store.wallet();
  const r = await providerFor(wallet).refund(p.providerRef ?? '');
  if (!r.ok) return { ok: false, payment: p, note: { ru: 'Провайдер не принял возврат.', en: 'The provider refused the refund.' } };
  p.status = 'refunded'; p.refundedAt = nowIso;
  await store.savePayment(p);
  await store.event({ at: nowIso, taskId: p.taskId ?? p.id, actor: byId, type: 'info', details: { kind: 'payment_refunded', paymentId: p.id, ref: r.ref } });
  for (const m of new Set([members.find(x => x.id === p.requestedBy)!, ...members.filter(x => x.isAdmin)])) {
    if (m.id === byId) continue;
    await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'info', text: say(m.lang, `↩️ ${by.name} отменил(а) заказ «${p.items}» — ${formatMoney(p.amount, p.currency)} вернутся на карту.`, `↩️ ${by.name} cancelled "${p.items}" — ${formatMoney(p.amount, p.currency)} will return to the card.`) });
  }
  return { ok: true, payment: p, note: { ru: `Возврат оформлен: ${formatMoney(p.amount, p.currency)} вернутся на карту. ${r.ref}`, en: `Refund issued: ${formatMoney(p.amount, p.currency)} will return to the card. ${r.ref}` } };
}

export function formatWallet(w: WalletPolicy, payments: Payment[], nowIso: string, lang: Lang): string {
  const spent = monthSpent(payments, nowIso);
  const paid = payments.filter(p => p.status === 'paid').length, declined = payments.filter(p => p.status === 'declined' || p.status === 'failed').length, refunded = payments.filter(p => p.status === 'refunded').length;
  return lang === 'ru'
    ? [`💳 Кошелёк семьи (${w.provider === 'stripe_test' ? 'Stripe test mode' : 'песочница'}) — карту агент не видит, только правила:`,
      `• Лимит на покупку: ${formatMoney(w.perTxLimit, w.currency)} · в месяц: ${formatMoney(w.monthlyLimit, w.currency)} (потрачено ${formatMoney(spent, w.currency)})`,
      `• Можно: ${w.allowedCategories.join(', ')}`, `• Нельзя никогда: ${w.blockedCategories.join(', ') || '—'}`,
      `• Дети сами: ${w.childMayOrder.join(', ') || 'ничего'}`, `• Знакомые продавцы: ${w.knownMerchants.map(m => m.name).join(', ') || 'пока нет (первый заказ у нового — через родителей)'}`,
      `• Адрес доставки: ${w.deliveryAddress ?? 'не задан — /wallet address <адрес>'}`,
      `Заказов: оплачено ${paid}, отклонено ${declined}, возвращено ${refunded}.`,
      `Настройка: /wallet limit 200 · /wallet monthly 2000 · /wallet allow kids · /wallet block clothes · /wallet child grocery · /wallet address …`].join('\n')
    : [`💳 Family wallet (${w.provider === 'stripe_test' ? 'Stripe test mode' : 'sandbox'}) — the agent never sees the card, only the rules:`,
      `• Per purchase: ${formatMoney(w.perTxLimit, w.currency)} · per month: ${formatMoney(w.monthlyLimit, w.currency)} (spent ${formatMoney(spent, w.currency)})`,
      `• Allowed: ${w.allowedCategories.join(', ')}`, `• Never: ${w.blockedCategories.join(', ') || '—'}`,
      `• Children on their own: ${w.childMayOrder.join(', ') || 'nothing'}`, `• Known merchants: ${w.knownMerchants.map(m => m.name).join(', ') || 'none yet (first order at a new one goes via the parents)'}`,
      `• Delivery address: ${w.deliveryAddress ?? 'not set — /wallet address <address>'}`,
      `Orders: paid ${paid}, declined ${declined}, refunded ${refunded}.`,
      `Settings: /wallet limit 200 · /wallet monthly 2000 · /wallet allow kids · /wallet block clothes · /wallet child grocery · /wallet address …`].join('\n');
}

/** /wallet <sub> <value> — admin edits. Returns the note to show. */
export async function editWallet(store: DomovoyStore, sub: string, value: string, lang: Lang): Promise<string> {
  const w = await store.wallet();
  const cat = value.trim().toLowerCase() as PaymentCategory;
  const num = parseInt(value);
  const isCat = PAYMENT_CATEGORIES.includes(cat);
  switch (sub) {
    case 'limit': if (!num) return say(lang, 'Нужно число.', 'A number is needed.'); w.perTxLimit = num; break;
    case 'monthly': if (!num) return say(lang, 'Нужно число.', 'A number is needed.'); w.monthlyLimit = num; break;
    case 'allow': if (!isCat) return say(lang, 'Категории: ' + PAYMENT_CATEGORIES.join(', '), 'Categories: ' + PAYMENT_CATEGORIES.join(', ')); w.allowedCategories = Array.from(new Set([...w.allowedCategories, cat])); w.blockedCategories = w.blockedCategories.filter(c => c !== cat); break;
    case 'block': if (!isCat) return say(lang, 'Категории: ' + PAYMENT_CATEGORIES.join(', '), 'Categories: ' + PAYMENT_CATEGORIES.join(', ')); w.blockedCategories = Array.from(new Set([...w.blockedCategories, cat])); w.allowedCategories = w.allowedCategories.filter(c => c !== cat); w.childMayOrder = w.childMayOrder.filter(c => c !== cat); break;
    case 'child': if (!isCat) return say(lang, 'Категории: ' + PAYMENT_CATEGORIES.join(', '), 'Categories: ' + PAYMENT_CATEGORIES.join(', ')); w.childMayOrder = Array.from(new Set([...w.childMayOrder, cat])); break;
    case 'address': if (!value.trim()) return say(lang, 'Напишите адрес после команды.', 'Write the address after the command.'); w.deliveryAddress = value.trim(); break;
    default: return say(lang, 'Не понял. Варианты: limit, monthly, allow, block, child, address.', 'Unknown. Options: limit, monthly, allow, block, child, address.');
  }
  await store.saveWallet(w);
  return say(lang, '✅ Правило обновлено.', '✅ Rule updated.');
}
