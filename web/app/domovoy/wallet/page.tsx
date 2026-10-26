import { panelContext } from '@/lib/domovoy-server';
import { getLang } from '@/lib/lang';
import { PageTitle, Panel, Pill, Empty } from '@/components/ui';
import { Avatar } from '@/components/domovoy/Member';
import { monthSpent, PAYMENT_CATEGORIES, type Payment } from '@core/domovoy/payments';
import { formatMoney } from '@core/domovoy/policy';
import { cartAction, refundAction, walletAction } from '../loop-actions';

export const dynamic = 'force-dynamic';

const PTONE: Record<Payment['status'], 'ok' | 'warn' | 'bad' | 'stone' | 'info'> = { paid: 'ok', pending_approval: 'warn', declined: 'bad', failed: 'bad', refunded: 'stone' };
const PSTATUS: Record<Payment['status'], { ru: string; en: string }> = {
  paid: { ru: 'оплачено', en: 'paid' }, pending_approval: { ru: 'ждёт родителей', en: 'awaiting parents' }, declined: { ru: 'отклонено правилами', en: 'declined by rules' }, failed: { ru: 'отклонил банк', en: 'bank declined' }, refunded: { ru: 'возврат', en: 'refunded' },
};
const CAT_RU: Record<string, string> = { grocery: 'продукты', pharmacy: 'аптека', kids: 'детское', household: 'хозтовары', transport: 'транспорт', food_delivery: 'доставка еды', education: 'образование', clothes: 'одежда', electronics: 'электроника', entertainment: 'развлечения', subscriptions: 'подписки', other: 'другое' };

export default async function WalletPage() {
  const lang = await getLang();
  const ru = lang === 'ru';
  const ctx = await panelContext();
  const { store } = ctx;
  const members = await store.members();
  const me = ctx.member ?? members.find(m => m.isAdmin) ?? members[0];
  const [wallet, payments, carts] = await Promise.all([store.wallet(), store.payments(), store.carts()]);
  const now = new Date().toISOString();
  const spent = monthSpent(payments, now);
  const cat = (c: string) => (ru ? CAT_RU[c] ?? c : c.replace('_', ' '));
  const name = (id: string) => members.find(m => m.id === id)?.name ?? id;
  const when = (iso: string) => iso.slice(5, 16).replace('T', ' ');
  const openCarts = carts.filter(c => c.status === 'sent');

  return (
    <>
      <PageTitle
        title={ru ? 'Кошелёк' : 'Wallet'}
        lead={ru ? 'Правила, по которым агент может платить сам, и всё, что он заказал. Карту агент не видит — только токен провайдера и эти правила. Сейчас: ' + (wallet.provider === 'stripe_test' ? 'Stripe test mode, настоящие тестовые платежи.' : 'песочница.') : 'The rules the agent may pay within, and everything it ordered. It never sees the card — only a provider token and these rules. Now: ' + (wallet.provider === 'stripe_test' ? 'Stripe test mode, real test payments.' : 'sandbox.')}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { l: ru ? 'За месяц' : 'This month', v: formatMoney(spent, wallet.currency), s: `${ru ? 'из' : 'of'} ${formatMoney(wallet.monthlyLimit, wallet.currency)}` },
          { l: ru ? 'Лимит на покупку' : 'Per purchase', v: formatMoney(wallet.perTxLimit, wallet.currency), s: ru ? 'выше — решают родители' : 'above — parents decide' },
          { l: ru ? 'Оплачено' : 'Paid', v: String(payments.filter(p => p.status === 'paid').length), s: `${payments.filter(p => p.status === 'refunded').length} ${ru ? 'возвратов' : 'refunds'}` },
          { l: ru ? 'Остановлено правилами' : 'Stopped by rules', v: String(payments.filter(p => (p.status === 'declined' || p.status === 'pending_approval') && p.rule).length), s: `${payments.filter(p => p.status === 'failed').length} ${ru ? 'отклонил банк' : 'bank declines'}` },
        ].map(t => <Panel key={t.l}><div className="px-5 py-4"><div className="text-[12px] uppercase tracking-wide text-mute">{t.l}</div><div className="num text-[26px] font-semibold mt-1">{t.v}</div><div className="text-[13px] text-mute">{t.s}</div></div></Panel>)}
      </div>

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5 items-start">
        <Panel title={ru ? 'Правила семьи' : 'Family rules'}>
          <div className="px-5 pb-5 text-[14px] space-y-3">
            <Row l={ru ? 'Можно' : 'Allowed'}>{wallet.allowedCategories.map(c => <Pill key={c} tone="ok">{cat(c)}</Pill>)}</Row>
            <Row l={ru ? 'Никогда' : 'Never'}>{wallet.blockedCategories.length ? wallet.blockedCategories.map(c => <Pill key={c} tone="bad">{cat(c)}</Pill>) : <span className="text-mute">—</span>}</Row>
            <Row l={ru ? 'Дети сами' : 'Children alone'}>{wallet.childMayOrder.length ? wallet.childMayOrder.map(c => <Pill key={c} tone="info">{cat(c)}</Pill>) : <span className="text-mute">{ru ? 'ничего' : 'nothing'}</span>}</Row>
            <Row l={ru ? 'Знакомые продавцы' : 'Known merchants'}>{wallet.knownMerchants.length ? wallet.knownMerchants.map(m => <Pill key={m.name} tone={m.agentCheckout ? 'accent' : 'stone'}>{m.name}{m.agentCheckout ? ' · 💳' : ''}</Pill>) : <span className="text-mute">{ru ? 'пока нет — первый заказ у нового через родителей' : 'none yet — the first order at a new one goes via the parents'}</span>}</Row>
            <Row l={ru ? 'Адрес доставки' : 'Delivery address'}><span>{wallet.deliveryAddress ?? <span className="text-mute">{ru ? 'не задан' : 'not set'}</span>}</span></Row>
            {me.isAdmin && (
              <div className="pt-3 border-t border-stone-100 space-y-2">
                <div className="text-[12px] uppercase tracking-wide text-mute">{ru ? 'Изменить (администратор)' : 'Change (admin)'}</div>
                <form action={walletAction} className="flex gap-2 flex-wrap">
                  <select name="sub" className="rounded border border-stone-300 bg-paper px-2 py-1.5 text-[13px]">
                    <option value="limit">{ru ? 'лимит на покупку' : 'per-purchase limit'}</option>
                    <option value="monthly">{ru ? 'лимит в месяц' : 'monthly limit'}</option>
                    <option value="allow">{ru ? 'разрешить категорию' : 'allow category'}</option>
                    <option value="block">{ru ? 'запретить категорию' : 'block category'}</option>
                    <option value="child">{ru ? 'детям можно' : 'children may'}</option>
                    <option value="address">{ru ? 'адрес доставки' : 'delivery address'}</option>
                  </select>
                  <input name="value" placeholder={ru ? '200 · grocery · адрес' : '200 · grocery · address'} className="flex-1 min-w-[160px] rounded border border-stone-300 px-2 py-1.5 text-[13px]" />
                  <button className="rounded-md accent-bg text-white px-3 py-1.5 text-[13px] font-medium">{ru ? 'сохранить' : 'save'}</button>
                </form>
                <p className="text-[12px] text-mute">{ru ? 'Категории: ' : 'Categories: '}{PAYMENT_CATEGORIES.join(', ')}</p>
              </div>
            )}
          </div>
        </Panel>

        <div className="space-y-5">
          {openCarts.length > 0 && (
            <Panel title={ru ? `Корзины ждут оплаты · ${openCarts.length}` : `Carts awaiting payment · ${openCarts.length}`}>
              <ul className="px-5 pb-4 space-y-3">
                {openCarts.map(c => (
                  <li key={c.id} className="rounded-card border border-stone-200 px-4 py-3 text-[14px]">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div><b>{c.merchant}</b> · {ru ? 'просит' : 'asked by'} {name(c.requestedBy)} · {ru ? 'платит' : 'payer'} {name(c.payerId)}{c.estimatedTotal ? ` · ≈ ${formatMoney(c.estimatedTotal, c.currency)}` : ''}</div>
                      <div className="flex gap-2">
                        <a href={c.homeUrl} target="_blank" rel="noreferrer" className="rounded-md border border-stone-300 bg-paper px-3 py-1 text-[13px]">{ru ? 'открыть магазин' : 'open shop'}</a>
                        {(me.isAdmin || me.id === c.payerId) && (
                          <form action={cartAction} className="flex gap-2">
                            <input type="hidden" name="cartId" value={c.id} />
                            <button name="op" value="paid" className="rounded-md accent-bg text-white px-3 py-1 text-[13px]">{ru ? 'оплатил(а)' : 'paid'}</button>
                            <button name="op" value="cancel" className="rounded-md border border-stone-300 bg-paper px-3 py-1 text-[13px]">{ru ? 'не нужно' : 'not needed'}</button>
                          </form>
                        )}
                      </div>
                    </div>
                    <div className="text-[13px] text-mute mt-1">{c.lines.map(l => `${l.text}${l.qty && l.qty > 1 ? ' ×' + l.qty : ''}`).join(', ')} → {c.deliveryAddress ?? '—'}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={ru ? 'Заказы и платежи' : 'Orders and payments'}>
            {payments.length === 0 ? <Empty>{ru ? 'Заказов пока не было. Скажите боту «закажи молоко в Carrefour».' : 'No orders yet. Tell the bot "order milk at Carrefour".'}</Empty> : (
              <ul className="px-5 pb-4 divide-y divide-stone-100 text-[14px]">
                {payments.slice(0, 30).map(p => {
                  const req = members.find(m => m.id === p.requestedBy);
                  return (
                    <li key={p.id} className="py-2.5 flex items-start gap-3">
                      {req ? <Avatar m={req} size={22} /> : <span className="w-[22px]" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><b>{p.items}</b><span className="text-mute">· {p.merchant} · {cat(p.category)}</span><Pill tone={PTONE[p.status]}>{ru ? PSTATUS[p.status].ru : PSTATUS[p.status].en}</Pill></div>
                        <div className="text-[12px] text-mute mt-0.5">{when(p.createdAt)} · {ru ? p.reason.ru : p.reason.en}{p.overrideBy ? ` · ${ru ? 'одобрил(а)' : 'approved by'} ${name(p.overrideBy)}` : ''}{p.receiptUrl ? <> · <a className="underline" href={p.receiptUrl} target="_blank" rel="noreferrer">{ru ? 'чек' : 'receipt'}</a></> : ''}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="num font-medium">{formatMoney(p.amount, p.currency)}</div>
                        {p.status === 'paid' && (me.isAdmin || me.id === p.requestedBy) && (
                          <form action={refundAction}><input type="hidden" name="paymentId" value={p.id} /><button className="text-[12px] text-mute underline">{ru ? 'вернуть' : 'refund'}</button></form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Row({ l, children }: { l: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[140px_1fr] gap-2 items-start"><span className="text-mute">{l}</span><span className="flex flex-wrap gap-1">{children}</span></div>;
}
