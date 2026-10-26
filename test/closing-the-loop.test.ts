/**
 * Closing the loop:
 *  - human checkpoints (approvals): request → approve/reject → action or fallback → expiry
 *  - weather ∩ outdoor plan → proposal → reschedule → verification → report to the author
 *  - low-risk weather chore → act directly, report with undo
 *  - visible learning: remind → ask → act as history grows, with a human-readable why
 *  - recurring prediction by autonomy level
 *  - impact metrics computed from the log
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FAMILY } from '../src/domovoy/fixtures';
import { InMemoryDomovoyStore } from '../src/domovoy/store';
import { approversFor, decideApproval, expireApprovals, requestApproval } from '../src/domovoy/approvals';
import { predictions, verification, weatherChores, weatherConflicts, rainWindows } from '../src/domovoy/autonomy';
import { decideAutonomy, learningReport, nextLevelHint } from '../src/domovoy/learning';
import { impactMetrics } from '../src/domovoy/metrics';
import { markDone, tick } from '../src/domovoy/household';
import { demoWeather } from '../src/domovoy/integrations';
import { detectPatterns } from '../src/domovoy/memory';
import type { Task } from '../src/domovoy/types';

const NOW = '2026-10-27T07:00:00.000Z'; // Tuesday 11:00 Dubai
const plus = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();

function mkStore() { return new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })), { householdId: 'h1', tz: 'Asia/Dubai' }); }
function mkTask(p: Partial<Task>): Task {
  return { id: 't1', authorId: 'mum', text: 'test', minutes: 15, skills: [], kidSafe: false, candidateIds: [], declinedBy: [], status: 'new', reminderLevel: 0, createdAt: NOW, ...p };
}

// ──────────── approvals ────────────

test('approvers: child schedule → admins only; a child author never decides', () => {
  const m = DEMO_FAMILY;
  assert.deepEqual(approversFor('change_child_schedule', m, 'son').sort(), ['dad', 'mum']);
  assert.deepEqual(approversFor('cancel_task', m, 'son').sort(), ['dad', 'mum']);
  assert.deepEqual(approversFor('cancel_task', m, 'granny'), ['granny']);
  assert.ok(approversFor('reschedule_task', m, 'dad').includes('dad'));
});

test('approve → action executes, the other approver is told, requester (agent) stays silent', async () => {
  const store = mkStore();
  await store.saveTask(mkTask({ id: 'k1', assigneeId: 'dad', status: 'accepted', dueAt: plus(NOW, 240), text: 'Отвезти Тимура на футбол', aboutMemberId: 'son' }));
  const a = await requestApproval(store, { action: 'change_child_schedule', payload: { taskId: 'k1', newDueAt: plus(NOW, 420) }, reason: { ru: 'дождь', en: 'rain' }, requestedBy: 'agent', authorId: 'mum', taskId: 'k1' }, NOW);
  assert.equal(a.status, 'pending');
  const approvalMsgs = (await store.outbox()).filter(m => m.kind === 'approval');
  assert.equal(approvalMsgs.length, 2, 'both parents asked');
  assert.ok(approvalMsgs.every(m => m.approvalId === a.id));

  const r = await decideApproval(store, a.id, 'mum', 'approve', plus(NOW, 5));
  assert.equal(r.outcome, 'executed');
  const t = (await store.tasks()).find(x => x.id === 'k1')!;
  assert.equal(t.dueAt, plus(NOW, 420));
  assert.equal(t.agentManaged, true);
  assert.equal(t.verifyAt, plus(NOW, 450), 'verification 30 min after the new time');
  const toDad = (await store.outbox()).filter(m => m.toId === 'dad');
  assert.ok(toDad.some(m => m.text.includes('перенесено')), 'executor told about the move');
  assert.ok(toDad.some(m => m.text.includes('одобрено')), 'other approver told the outcome');
});

test('a non-approver cannot decide; a decided approval cannot be decided twice', async () => {
  const store = mkStore();
  await store.saveTask(mkTask({ id: 'k2', assigneeId: 'dad', status: 'accepted', dueAt: plus(NOW, 60) }));
  const a = await requestApproval(store, { action: 'spend_money', payload: { amount: 500, currency: 'AED', purpose: 'gift' }, reason: { ru: 'подарок', en: 'gift' }, requestedBy: 'son' }, NOW);
  assert.equal((await decideApproval(store, a.id, 'son', 'approve', NOW)).outcome, 'not_allowed');
  assert.equal((await decideApproval(store, a.id, 'dad', 'approve', NOW)).outcome, 'executed');
  assert.equal((await decideApproval(store, a.id, 'mum', 'reject', NOW)).outcome, 'closed');
  // the child who asked is told
  assert.ok((await store.outbox()).some(m => m.toId === 'son' && m.text.includes('одобрено')));
});

test('reject with a fallback → the fallback action runs (raincoat task) so the loop still closes', async () => {
  const store = mkStore();
  await store.saveTask(mkTask({ id: 'k3', assigneeId: 'dad', status: 'accepted', dueAt: plus(NOW, 240), text: 'Прогулка в парке' }));
  const a = await requestApproval(store, { action: 'reschedule_task', payload: { taskId: 'k3', newDueAt: plus(NOW, 420), onReject: { action: 'create_task', payload: { task: { text: 'Взять дождевик', minutes: 5, skills: [], kidSafe: true }, assigneeId: 'dad', authorId: 'mum', origin: 'weather' } } },
    reason: { ru: 'дождь', en: 'rain' }, fallback: { ru: 'напомню про дождевик', en: 'raincoat reminder' }, requestedBy: 'agent', authorId: 'mum', taskId: 'k3' }, NOW);
  const r = await decideApproval(store, a.id, 'mum', 'reject', NOW);
  assert.equal(r.outcome, 'fallback');
  const tasks = await store.tasks();
  assert.equal(tasks.find(t => t.id === 'k3')!.dueAt, plus(NOW, 240), 'original untouched');
  const rc = tasks.find(t => t.text === 'Взять дождевик')!;
  assert.ok(rc, 'fallback task created');
  assert.equal(rc.assigneeId, 'dad');
  assert.equal(rc.origin, 'weather');
});

test('expired approvals are closed by tick and the requester is told nothing changed', async () => {
  const store = mkStore();
  const a = await requestApproval(store, { action: 'cancel_task', payload: { taskId: 'none' }, reason: { ru: 'x', en: 'x' }, requestedBy: 'dad', approverIds: ['mum'], ttlMin: 10 }, NOW);
  assert.equal((await expireApprovals(store, plus(NOW, 5))).length, 0);
  const expired = await expireApprovals(store, plus(NOW, 11));
  assert.equal(expired.length, 1);
  assert.equal((await store.approvals())[0].status, 'expired');
  assert.ok((await store.outbox()).some(m => m.toId === 'dad' && m.text.includes('Никто не ответил')));
  assert.equal(a.id, expired[0].id);
});

// ──────────── weather scenarios ────────────

test('rain ∩ outdoor task → approval to parents with a dry alternative; approve → reschedule → verify → report', async () => {
  const store = mkStore();
  const weather = demoWeather('rain', NOW); // rain in slots +3h and +6h, dry from +9h
  const w = rainWindows(weather);
  assert.equal(w.length, 2);
  await store.saveTask(mkTask({ id: 'fb', authorId: 'mum', assigneeId: 'dad', status: 'accepted', dueAt: plus(NOW, 200), text: 'Отвезти Тимура на футбол', skills: ['drive'], aboutMemberId: 'son', minutes: 50 }));
  await store.saveTask(mkTask({ id: 'in', authorId: 'mum', assigneeId: 'joy', status: 'accepted', dueAt: plus(NOW, 200), text: 'Погладить рубашки', skills: ['laundry'] }));

  const sent = await weatherConflicts(store, NOW, weather);
  assert.equal(sent.filter(s => s.kind === 'weather_conflict').length, 1, 'only the outdoor task is a conflict');
  const [a] = await store.approvals({ status: 'pending' });
  assert.equal(a.action, 'change_child_schedule', 'touches a child → parents decide');
  assert.deepEqual([...a.approverIds].sort(), ['dad', 'mum']);
  assert.ok(a.reason.ru.includes('дождь') && a.reason.ru.includes('футбол'));
  const newDueAt = a.payload.newDueAt as string;
  assert.ok(newDueAt > plus(NOW, 420), 'alternative is after the rain');
  // idempotent within 24h
  assert.equal((await weatherConflicts(store, plus(NOW, 30), weather)).length, 0);

  await decideApproval(store, a.id, 'mum', 'approve', plus(NOW, 5));
  const t = (await store.tasks()).find(x => x.id === 'fb')!;
  assert.equal(t.dueAt, newDueAt);
  assert.equal(t.rescheduledFrom, plus(NOW, 200));

  // verification fires 30 min after the new time, to the executor, with done / not done buttons
  assert.equal((await verification(store, plus(newDueAt, 10))).length, 0);
  const v = await verification(store, plus(newDueAt, 31));
  assert.equal(v.length, 1);
  assert.equal(v[0].toId, 'dad');
  const vm = (await store.outbox()).find(m => m.kind === 'verification')!;
  assert.equal(vm.taskId, 'fb');

  // executor confirms → the author gets the "loop closed" report
  await markDone(store, 'fb', 'dad', plus(newDueAt, 40));
  const report = (await store.outbox()).find(m => m.kind === 'report' && m.toId === 'mum')!;
  assert.ok(report, 'author informed');
  assert.ok(report.text.includes('Цикл закрыт'));
  const ev = await store.events();
  assert.ok(ev.some(e => e.type === 'verified' && e.taskId === 'fb'));
  assert.ok(ev.some(e => e.type === 'loop_closed' && e.taskId === 'fb'));
});

test('verification with no answer → hand over + author warned (never waits silently)', async () => {
  const store = mkStore();
  await store.saveTask(mkTask({ id: 'v1', authorId: 'mum', assigneeId: 'dad', status: 'accepted', dueAt: NOW, text: 'Забрать посылку', skills: ['drive'], candidateIds: ['dad', 'granny'], agentManaged: true, verifyAt: plus(NOW, 30) }));
  await verification(store, plus(NOW, 31));
  const esc = await verification(store, plus(NOW, 125));
  assert.ok(esc.some(s => s.kind === 'verify_escalated'));
  const t = (await store.tasks()).find(x => x.id === 'v1')!;
  assert.notEqual(t.assigneeId, 'dad', 'handed over to the next candidate');
});

test('rain forecast → low-risk chore is created and assigned directly, admins get an undo message; once per day', async () => {
  const store = mkStore();
  const weather = demoWeather('rain', NOW);
  const sent = await weatherChores(store, NOW, weather);
  assert.equal(sent.filter(s => s.kind === 'autonomous_weather_chore').length, 2, 'both admins informed');
  const chore = (await store.tasks()).find(t => t.origin === 'weather')!;
  assert.ok(chore);
  assert.equal(chore.assigneeId, 'joy', 'helper with laundry skill inside working hours');
  assert.equal(chore.agentManaged, true);
  assert.equal(chore.decision?.level, 'act');
  assert.ok((await store.outbox()).some(m => m.kind === 'autonomous' && m.taskId === chore.id));
  assert.equal((await weatherChores(store, plus(NOW, 60), weather)).length, 0, 'not repeated the same day');
  assert.ok((await store.events()).some(e => e.type === 'autonomous_action'));
});

test('tick with dry demo weather creates no chores and no approvals', async () => {
  const store = mkStore();
  delete process.env.DOMOVOY_DEMO_WEATHER;
  await tick(store, NOW);
  assert.equal((await store.tasks()).filter(t => t.origin === 'weather').length, 0);
  assert.equal((await store.approvals()).length, 0);
});

// ──────────── visible learning ────────────

async function seedHistory(store: InMemoryDomovoyStore, n: number, executor = 'dad', text = 'Купить молоко') {
  for (let i = 0; i < n; i++) {
    const at = `2026-10-${String(10 + i).padStart(2, '0')}T06:00:00.000Z`;
    await store.saveTask(mkTask({ id: `h${i}`, authorId: 'mum', assigneeId: executor, status: 'done', text, skills: ['shop'], createdAt: at, dueAt: at, assignedAt: at, doneAt: plus(at, 40) }));
    await store.event({ at, taskId: `h${i}`, actor: 'agent', type: 'assigned', details: { to: executor } });
    await store.event({ at: plus(at, 3), taskId: `h${i}`, actor: executor, type: 'accepted' });
  }
}

test('autonomy grows with history: 0 → remind, 1–2 → ask, 3+ with good completion → act; why is human-readable', async () => {
  const members = DEMO_FAMILY;
  const chore = { text: 'Купить молоко', skills: ['shop'], authorId: 'mum' };
  const s0 = mkStore();
  const d0 = decideAutonomy({ tasks: await s0.tasks(), patterns: [], members, chore, candidateId: 'dad' });
  assert.equal(d0.level, 'remind');
  assert.match(nextLevelHint(d0, 0, 'ru'), /ещё 1 выполнение/);

  const s1 = mkStore(); await seedHistory(s1, 2);
  const p1 = await detectPatterns(s1, NOW);
  const d1 = decideAutonomy({ tasks: await s1.tasks(), patterns: p1, members, chore, candidateId: 'dad' });
  assert.equal(d1.level, 'ask');
  assert.match(d1.why.ru, /Алексей делал\(а\) это 2 из 2/);

  const s3 = mkStore(); await seedHistory(s3, 5);
  const p3 = await detectPatterns(s3, NOW);
  const d3 = decideAutonomy({ tasks: await s3.tasks(), patterns: p3, members, chore, candidateId: 'dad' });
  assert.equal(d3.level, 'act');
  assert.ok(d3.confidence >= 0.7);
  assert.ok(d3.evidence.some(e => e.startsWith('done_by_candidate:5')));
  assert.match(d3.why.en, /assigning on my own/);

  // the same history says nothing about a different person
  const dOther = decideAutonomy({ tasks: await s3.tasks(), patterns: p3, members, chore, candidateId: 'granny' });
  assert.equal(dOther.level, 'remind');
});

test('a member who avoids this skill never reaches ask/act even with history', async () => {
  const s = mkStore(); await seedHistory(s, 4);
  const patterns = await detectPatterns(s, NOW);
  patterns.push({ householdId: 'h1', memberId: 'dad', patternType: 'decline_skill', data: { skills: { shop: 3 } }, confidence: 0.5, observedCount: 3, firstSeen: NOW, lastSeen: NOW, active: true });
  const d = decideAutonomy({ tasks: await s.tasks(), patterns, members: DEMO_FAMILY, chore: { text: 'Купить молоко', skills: ['shop'], authorId: 'mum' }, candidateId: 'dad' });
  assert.equal(d.level, 'remind');
  assert.ok(d.evidence.includes('decline_skill'));
});

test('learningReport lists recurring chores with level and next-level hint', async () => {
  const s = mkStore(); await seedHistory(s, 5);
  await detectPatterns(s, NOW);
  const rep = await learningReport(s, 'ru');
  assert.equal(rep.rows.length, 1);
  assert.equal(rep.rows[0].level, 'act');
  assert.equal(rep.rows[0].executorName, 'Алексей');
  assert.match(rep.summary, /1 делаю сам/);
});

// ──────────── predictions ────────────

test('recurring chore due again: act level → created & assigned with an undo message; ask level → approval; dedup', async () => {
  // daily milk for 5 days, last one yesterday 06:00Z → next due today 06:00Z (within window of NOW 07:00Z)
  const sAct = mkStore();
  for (let i = 0; i < 5; i++) {
    const at = `2026-10-${22 + i}T06:00:00.000Z`;
    await sAct.saveTask(mkTask({ id: `m${i}`, authorId: 'mum', assigneeId: 'joy', status: 'done', text: 'Купить молоко', skills: ['shop'], minutes: 20, createdAt: at, dueAt: at, assignedAt: at, doneAt: plus(at, 30) }));
  }
  await detectPatterns(sAct, NOW);
  const sent = await predictions(sAct, NOW);
  assert.ok(sent.some(s => s.kind === 'prediction_act'), JSON.stringify(sent));
  const created = (await sAct.tasks()).find(t => t.origin === 'prediction')!;
  assert.ok(created);
  assert.equal(created.assigneeId, 'joy');
  assert.equal(created.decision?.level, 'act');
  assert.ok((await sAct.outbox()).some(m => m.kind === 'autonomous' && m.toId === 'mum'));
  assert.equal((await predictions(sAct, plus(NOW, 10))).length, 0, 'no duplicate prediction');

  // ask level: 3 occurrences, executors split → usual executor did it 2 times
  const sAsk = mkStore();
  for (let i = 0; i < 3; i++) {
    const at = `2026-10-${24 + i}T06:00:00.000Z`;
    await sAsk.saveTask(mkTask({ id: `a${i}`, authorId: 'mum', assigneeId: i === 0 ? 'dad' : 'joy', status: 'done', text: 'Купить молоко', skills: ['shop'], createdAt: at, dueAt: at, assignedAt: at, doneAt: plus(at, 30) }));
  }
  await detectPatterns(sAsk, NOW);
  const sent2 = await predictions(sAsk, NOW);
  assert.ok(sent2.some(s => s.kind === 'prediction_ask'), JSON.stringify(sent2));
  const [ap] = await sAsk.approvals({ status: 'pending' });
  assert.equal(ap.action, 'create_task');
  assert.ok(ap.approverIds.includes('mum'));
  // approving creates the task
  await decideApproval(sAsk, ap.id, 'mum', 'approve', NOW);
  assert.ok((await sAsk.tasks()).some(t => t.origin === 'prediction' && t.assigneeId === 'joy'));
});

// ──────────── impact metrics ────────────

test('impactMetrics counts from the log and estimates time saved transparently', async () => {
  const store = mkStore();
  await seedHistory(store, 3, 'dad');
  // one reminded task, one autonomous weather chore, one executed approval
  await store.saveTask(mkTask({ id: 'r1', assigneeId: 'joy', status: 'done', createdAt: plus(NOW, -60), doneAt: plus(NOW, -10), reminderLevel: 1 }));
  await store.event({ at: plus(NOW, -30), taskId: 'r1', actor: 'agent', type: 'reminded', details: { level: 1 } });
  await weatherChores(store, plus(NOW, -20), demoWeather('rain', plus(NOW, -20)));
  await store.saveTask(mkTask({ id: 'c1', assigneeId: 'dad', status: 'accepted', dueAt: plus(NOW, 60) }));
  const a = await requestApproval(store, { action: 'reschedule_task', payload: { taskId: 'c1', newDueAt: plus(NOW, 120) }, reason: { ru: 'x', en: 'x' }, requestedBy: 'agent', authorId: 'mum' }, plus(NOW, -5));
  await decideApproval(store, a.id, 'mum', 'approve', NOW);

  const m = await impactMetrics(store, NOW, 30);
  assert.equal(m.tasksDone, 4);
  assert.equal(m.doneWithoutReminder, 3);
  assert.equal(m.doneWithoutReminderPct, 75);
  assert.equal(m.remindersSent, 1);
  assert.equal(m.autonomousActions, 1);
  assert.equal(m.approvalsRequested, 1);
  assert.equal(m.approvalsApproved, 1);
  assert.equal(m.approvalRatePct, 100);
  assert.equal(m.conflictsPrevented, 1);
  assert.equal(m.avgResponseMin, 3);
  const A = m.assumptions;
  assert.equal(m.estimatedMinutesSaved, m.tasksCreated * A.perDispatchedTask + 1 * A.perReminder + 0 * A.perSwap + 1 * A.perAutonomousAction + 1 * A.perConflictPrevented);
  assert.ok(m.perMember.find(x => x.id === 'dad')!.done >= 3);
});

// ──────────── money: multi-currency threshold ────────────

test('money checkpoint is multi-currency: household currency from timezone, sums converted before the check', async () => {
  const { convert, defaultCurrency, needsMoneyApproval, parseCurrency, DEFAULT_THRESHOLD } = await import('../src/domovoy/policy');
  assert.equal(defaultCurrency('Asia/Dubai'), 'AED');
  assert.equal(defaultCurrency('Asia/Almaty'), 'KZT');
  assert.equal(defaultCurrency('Europe/Istanbul'), 'TRY');
  assert.equal(defaultCurrency('Europe/Moscow'), 'RUB');
  assert.equal(parseCurrency('дирхам'), 'AED');
  assert.equal(parseCurrency('тенге'), 'KZT');
  assert.equal(parseCurrency('$'), 'USD');
  assert.equal(parseCurrency('xyz'), undefined);
  assert.ok(Math.abs(convert(100, 'USD', 'AED') - 367) < 1);
  const kz = { currency: 'KZT' as const, moneyThreshold: DEFAULT_THRESHOLD.KZT };
  assert.equal(needsMoneyApproval(10000, 'KZT', kz).needs, false);
  assert.equal(needsMoneyApproval(100, 'USD', kz).needs, true, '100 USD ≈ 54k KZT > 30k');
  const ae = new InMemoryDomovoyStore(DEMO_FAMILY, { tz: 'Asia/Almaty' });
  assert.equal(ae.currency, 'KZT');
  assert.equal(ae.moneyThreshold, 30000);
});
