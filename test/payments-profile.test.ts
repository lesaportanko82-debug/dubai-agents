/**
 * Payments with rules + household profile.
 *  - wallet rules: limits, categories, children, unknown merchants
 *  - order flow: need address once → paid with receipt → refund; over limit → card declines → parents → override
 *  - profile: access levels, sealing of medical facts, ask-once via remember_fact
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FAMILY } from '../src/domovoy/fixtures';
import { InMemoryDomovoyStore } from '../src/domovoy/store';
import { defaultWallet, evaluateOrder, monthSpent, placeOrder, refundPayment } from '../src/domovoy/payments';
import { decideApproval } from '../src/domovoy/approvals';
import { canSee, rememberFact, seal, unseal, visibleFacts, profileContext, defaultAccess } from '../src/domovoy/profile';
import { impactMetrics } from '../src/domovoy/metrics';

const NOW = '2026-10-27T07:00:00.000Z';
const by = (id: string) => DEMO_FAMILY.find(m => m.id === id)!;
function mkStore() { return new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })), { householdId: 'h1', tz: 'Asia/Dubai' }); }

test('wallet rules: blocked outright, child category, per-tx, monthly, unknown merchant, allowed', () => {
  const w = defaultWallet('AED');
  w.knownMerchants.push({ name: 'Carrefour', category: 'grocery' });
  assert.equal(evaluateOrder(w, by('mum'), { merchant: 'Carrefour', category: 'subscriptions', amountInWallet: 10 }, 0).rule, 'blocked_category');
  assert.equal(evaluateOrder(w, by('mum'), { merchant: 'Carrefour', category: 'subscriptions', amountInWallet: 10 }, 0).escalate, false, 'blocked: not even an approval');
  assert.equal(evaluateOrder(w, by('son'), { merchant: 'Carrefour', category: 'grocery', amountInWallet: 10 }, 0).rule, 'child_not_allowed');
  w.childMayOrder.push('grocery');
  assert.equal(evaluateOrder(w, by('son'), { merchant: 'Carrefour', category: 'grocery', amountInWallet: 10 }, 0).allow, true);
  assert.equal(evaluateOrder(w, by('mum'), { merchant: 'Carrefour', category: 'grocery', amountInWallet: 500 }, 0).rule, 'per_tx_limit');
  assert.equal(evaluateOrder(w, by('mum'), { merchant: 'Carrefour', category: 'grocery', amountInWallet: 100 }, 1450).rule, 'monthly_limit');
  assert.equal(evaluateOrder(w, by('mum'), { merchant: 'Noon', category: 'grocery', amountInWallet: 100 }, 0).rule, 'unknown_merchant');
  assert.equal(evaluateOrder(w, by('mum'), { merchant: 'carrefour', category: 'grocery', amountInWallet: 100 }, 0).allow, true, 'merchant match is case-insensitive');
});

test('order flow: address asked once → paid with receipt + refund button → refund; merchant becomes known', async () => {
  const store = mkStore();
  const w = await store.wallet(); w.knownMerchants.push({ name: 'Carrefour', category: 'grocery' }); await store.saveWallet(w);
  const r0 = await placeOrder(store, { requestedBy: 'mum', merchant: 'Carrefour', category: 'grocery', amount: 25, items: 'Молоко' }, NOW);
  assert.equal(r0.outcome, 'need_address');
  // the person answers once → remembered in the profile as "home" → the wallet picks it up
  await rememberFact(store, by('mum'), { key: 'home', value: 'Marina Gate 1, apt 1204', kind: 'place' }, NOW);
  const r1 = await placeOrder(store, { requestedBy: 'mum', merchant: 'Carrefour', category: 'grocery', amount: 25, items: 'Молоко' }, NOW);
  assert.equal(r1.outcome, 'paid');
  assert.equal(r1.payment.status, 'paid');
  assert.ok(r1.payment.providerRef?.startsWith('sim_'));
  assert.equal((await store.wallet()).deliveryAddress, 'Marina Gate 1, apt 1204');
  const receipts = (await store.outbox()).filter(m => m.kind === 'receipt');
  assert.equal(receipts.length, 2, 'requester (admin) + the other admin');
  assert.ok(receipts.every(m => m.paymentId === r1.payment.id));
  assert.ok(receipts[0].text.includes('Marina Gate'));
  assert.equal(monthSpent(await store.payments(), NOW), 25);
  // a new merchant in a different currency, within limits, becomes known after the first paid order (admin)
  const r2 = await placeOrder(store, { requestedBy: 'mum', merchant: 'Noon', category: 'household', amount: 5, currency: 'USD', items: 'Губки' }, NOW);
  assert.equal(r2.outcome, 'pending_approval', 'first order at an unknown merchant → parents');
  // refund by a non-owner non-admin is refused; by admin works
  const bad = await refundPayment(store, r1.payment.id, 'granny', NOW);
  assert.equal(bad.ok, false);
  const ok = await refundPayment(store, r1.payment.id, 'dad', NOW);
  assert.equal(ok.ok, true);
  assert.equal((await store.payments()).find(p => p.id === r1.payment.id)!.status, 'refunded');
  assert.equal(monthSpent(await store.payments(), NOW), 0);
  assert.ok((await store.outbox()).some(m => m.toId === 'mum' && m.text.includes('отменил')));
});

test('over the limit: card declines, parents get an approval, approve → charged with override, receipt names the parent', async () => {
  const store = mkStore();
  const w = await store.wallet(); w.knownMerchants.push({ name: 'Carrefour', category: 'kids' }); w.deliveryAddress = 'home'; await store.saveWallet(w);
  const r = await placeOrder(store, { requestedBy: 'granny', merchant: 'Carrefour', category: 'kids', amount: 500, items: 'Велосипед' }, NOW);
  assert.equal(r.outcome, 'pending_approval');
  assert.equal(r.payment.rule, 'per_tx_limit');
  const [a] = await store.approvals({ status: 'pending' });
  assert.equal(a.action, 'spend_money');
  assert.deepEqual([...a.approverIds].sort(), ['dad', 'mum']);
  assert.equal(a.payload.paymentId, r.payment.id);
  assert.ok((await store.outbox()).some(m => m.toId === 'granny' && m.text.includes('на одобрение')));
  const d = await decideApproval(store, a.id, 'dad', 'approve', NOW);
  assert.equal(d.outcome, 'executed');
  const p = (await store.payments()).find(x => x.id === r.payment.id)!;
  assert.equal(p.status, 'paid');
  assert.equal(p.overrideBy, 'dad');
  const receipt = (await store.outbox()).find(m => m.kind === 'receipt')!;
  assert.ok(receipt.text.includes('Алексей'), 'receipt names who approved');
  assert.equal(monthSpent(await store.payments(), NOW), 500);
});

test('rejecting the payment approval leaves it unpaid; blocked category never reaches the parents', async () => {
  const store = mkStore();
  const w = await store.wallet(); w.knownMerchants.push({ name: 'Carrefour', category: 'kids' }); w.deliveryAddress = 'home'; await store.saveWallet(w);
  const r = await placeOrder(store, { requestedBy: 'mum', merchant: 'Carrefour', category: 'kids', amount: 500, items: 'Велосипед' }, NOW);
  const [a] = await store.approvals({ status: 'pending' });
  await decideApproval(store, a.id, 'dad', 'reject', NOW);
  assert.equal((await store.payments()).find(x => x.id === r.payment.id)!.status, 'pending_approval');
  assert.equal(monthSpent(await store.payments(), NOW), 0);
  const b = await placeOrder(store, { requestedBy: 'mum', merchant: 'Carrefour', category: 'subscriptions', amount: 10, items: 'Netflix' }, NOW);
  assert.equal(b.outcome, 'declined');
  assert.equal((await store.approvals({ status: 'pending' })).length, 0, 'no approval for a blocked category');
});

test('bank decline (test card) → failed, nothing charged, everyone told', async () => {
  const store = mkStore();
  const w = await store.wallet(); w.knownMerchants.push({ name: 'Carrefour', category: 'grocery' }); w.deliveryAddress = 'home'; await store.saveWallet(w);
  const r = await placeOrder(store, { requestedBy: 'mum', merchant: 'Carrefour', category: 'grocery', amount: 20, items: 'Хлеб' }, NOW, { forceDecline: true });
  assert.equal(r.outcome, 'card_declined');
  assert.equal(r.payment.status, 'failed');
  assert.equal(monthSpent(await store.payments(), NOW), 0);
  assert.ok((await store.outbox()).some(m => m.text.includes('Ничего не списано')));
});

test('profile: access levels — medical adults-only, personal owner+parents, places for the family', async () => {
  const store = mkStore();
  await rememberFact(store, by('mum'), { key: 'home', value: 'Marina Gate 1', kind: 'place' }, NOW);
  await rememberFact(store, by('mum'), { key: 'allergy:son', value: 'арахис', aboutMemberId: 'son' }, NOW);
  await rememberFact(store, by('mum'), { key: 'shoe_size:son', value: '36', aboutMemberId: 'son' }, NOW);
  assert.equal(defaultAccess('allergy:son', 'son'), 'adults');
  assert.equal(defaultAccess('shoe_size:son', 'son'), 'owner');
  const forJoy = (await visibleFacts(store, by('joy'))).map(f => f.key);
  assert.deepEqual(forJoy, ['home'], 'helper sees only family-level places');
  const forSon = (await visibleFacts(store, by('son'))).map(f => f.key).sort();
  assert.deepEqual(forSon, ['home', 'shoe_size:son'], 'child sees his own non-medical facts');
  const forGranny = (await visibleFacts(store, by('granny'))).map(f => f.key).sort();
  assert.deepEqual(forGranny, ['allergy:son', 'home'], 'elder is an adult: sees medical, not another person\'s private fact');
  assert.ok(canSee((await store.profile()).find(f => f.key === 'allergy:son')!, by('dad')));
  // a child cannot write someone else's facts or medical ones
  await assert.rejects(rememberFact(store, by('son'), { key: 'allergy:masha', value: 'x', aboutMemberId: 'masha' }, NOW));
  await assert.rejects(rememberFact(store, by('joy'), { key: 'home', value: 'elsewhere' }, NOW));
  // the system prompt never carries medical facts
  const ctx = await profileContext(store, by('mum'));
  assert.ok(ctx.includes('home'));
  assert.ok(!ctx.includes('арахис'));
  assert.ok(ctx.includes('get_profile'));
});

test('sealing: with PROFILE_KEY medical values are encrypted at rest and decrypt back; without it they stay plain', () => {
  delete process.env.PROFILE_KEY;
  assert.deepEqual(seal('арахис'), { value: 'арахис', sealed: false });
  process.env.PROFILE_KEY = 'test-key';
  const s = seal('арахис');
  assert.equal(s.sealed, true);
  assert.ok(s.value.startsWith('v1:') && !s.value.includes('арахис'));
  assert.equal(unseal(s.value, true), 'арахис');
  process.env.PROFILE_KEY = 'other-key';
  assert.match(unseal(s.value, true), /cannot decrypt/);
  delete process.env.PROFILE_KEY;
});

test('impact metrics include payments', async () => {
  const store = mkStore();
  const w = await store.wallet(); w.knownMerchants.push({ name: 'Carrefour', category: 'grocery' }); w.deliveryAddress = 'home'; await store.saveWallet(w);
  await placeOrder(store, { requestedBy: 'mum', merchant: 'Carrefour', category: 'grocery', amount: 25, items: 'Молоко' }, NOW);
  await placeOrder(store, { requestedBy: 'mum', merchant: 'Carrefour', category: 'grocery', amount: 900, items: 'Телевизор' }, NOW);
  const m = await impactMetrics(store, NOW, 7);
  assert.equal(m.payments.paid, 1);
  assert.equal(m.payments.stoppedByRules, 1);
  assert.equal(m.payments.spent, 25);
});
