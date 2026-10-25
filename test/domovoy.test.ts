import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FAMILY } from '../src/domovoy/fixtures';
import { InMemoryDomovoyStore } from '../src/domovoy/store';
import { rankCandidates } from '../src/domovoy/tools/assign';
import { canAssign } from '../src/domovoy/tools/rules';
import { dueReminders } from '../src/domovoy/tools/reminders';
import { weeklyLedger, balanceSuggestion } from '../src/domovoy/tools/fairness';
import { assignTask, buildContext, markDone, respond, tick } from '../src/domovoy/household';
import { runDispatch } from '../src/domovoy/agent';
import type { Task } from '../src/domovoy/types';
import type { ModelClient, ModelResponse } from '../src/owed/agent';

// Tuesday 2026-10-27, 15:00 Dubai (11:00Z)
const NOW = '2026-10-27T11:00:00.000Z';
const FRIDAY = '2026-10-30T11:00:00.000Z';

function mkTask(p: Partial<Task>): Task {
  return { id: 't1', authorId: 'mum', text: 'test', minutes: 15, skills: [], kidSafe: false, candidateIds: [], declinedBy: [], status: 'new', reminderLevel: 0, createdAt: NOW, ...p };
}
const by = (id: string) => DEMO_FAMILY.find(m => m.id === id)!;

test('child cannot get an unsafe or too-long task; can get a kid chore', () => {
  assert.equal(canAssign(by('son'), mkTask({ skills: ['drive'], kidSafe: false }), { now: NOW, openTasksToday: 0 }).ok, false);
  assert.equal(canAssign(by('son'), mkTask({ skills: ['water_plants'], kidSafe: true, minutes: 10 }), { now: NOW, openTasksToday: 0 }).ok, true);
  assert.equal(canAssign(by('masha'), mkTask({ skills: ['feed_cat'], kidSafe: true }), { now: NOW, openTasksToday: 0 }).reason, 'missing skill');
  assert.equal(canAssign({ ...by('masha'), skills: ['feed_cat'] }, mkTask({ skills: ['feed_cat'], kidSafe: true }), { now: NOW, openTasksToday: 0 }).reason, 'too young for feed_cat');
});

test('helper is blocked on day off and outside working hours', () => {
  const shop = mkTask({ skills: ['shop'], dueAt: '2026-10-30T12:00:00.000Z' }); // Friday 16:00 Dubai
  assert.equal(canAssign(by('joy'), shop, { now: FRIDAY, openTasksToday: 0 }).reason, 'helper day off');
  const late = mkTask({ skills: ['shop'], dueAt: '2026-10-27T17:00:00.000Z' }); // Tuesday 21:00 Dubai
  assert.equal(canAssign(by('joy'), late, { now: NOW, openTasksToday: 0 }).reason, 'outside helper working hours');
  const ok = mkTask({ skills: ['shop'], dueAt: '2026-10-27T12:00:00.000Z' }); // Tuesday 16:00 Dubai
  assert.equal(canAssign(by('joy'), ok, { now: NOW, openTasksToday: 0 }).ok, true);
});

test('ranking: author is not first; fairness pushes the less-loaded adult up; skills are alternatives', () => {
  const pickup = mkTask({ skills: ['drive', 'pickup_walk'], dueAt: '2026-10-27T13:00:00.000Z', minutes: 40 });
  const ctx = { now: NOW, weekMinutes: { mum: 300, dad: 60 }, openToday: {} };
  const { allowed, blocked } = rankCandidates(DEMO_FAMILY, pickup, ctx);
  assert.equal(allowed[0].memberId, 'dad');
  assert.ok(allowed.some(c => c.memberId === 'granny')); // can walk
  assert.ok(allowed.some(c => c.memberId === 'joy'));    // within working hours, as backup
  assert.ok(blocked.some(b => b.memberId === 'son'));
});

test('calendar clash blocks a member at the due time', () => {
  const dad = { ...by('dad'), busy: [{ from: '2026-10-27T12:30:00.000Z', to: '2026-10-27T14:00:00.000Z', what: 'meeting' }] };
  const r = canAssign(dad, mkTask({ skills: ['drive'], dueAt: '2026-10-27T13:00:00.000Z' }), { now: NOW, openTasksToday: 0 });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /busy/);
});

test('decline → swap to next allowed candidate; nobody left → unassigned and author informed', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })));
  const t = mkTask({ id: 'p1', skills: ['pickup_walk'], dueAt: '2026-10-27T13:00:00.000Z', minutes: 30 });
  const ctx = await buildContext(store, NOW);
  t.candidateIds = rankCandidates(DEMO_FAMILY, t, ctx).allowed.map(c => c.memberId);
  await store.saveTask(t);
  const first = t.candidateIds[0];
  await assignTask(store, t, first, 'test', NOW);
  const r1 = await respond(store, 'p1', first, 'decline', NOW);
  assert.ok(r1.swappedTo && r1.swappedTo !== first);
  assert.equal(r1.task.status, 'assigned');
  // decline until nobody is left
  let cur = r1.swappedTo!;
  for (let i = 0; i < 6 && cur; i++) {
    const r = await respond(store, 'p1', cur, 'decline', NOW);
    cur = r.swappedTo!;
  }
  const final = (await store.tasks()).find(x => x.id === 'p1')!;
  assert.equal(final.status, 'unassigned');
  const out = await store.outbox();
  assert.ok(out.some(m => m.toId === 'mum' && m.kind === 'info'));
});

test('reminder ladder escalates in time, speaks recipient language, never targets the author', () => {
  const t = mkTask({ id: 'r1', assigneeId: 'joy', status: 'assigned', dueAt: '2026-10-27T12:00:00.000Z', text: 'bumili ng gatas' });
  const own = mkTask({ id: 'r2', authorId: 'mum', assigneeId: 'mum', status: 'assigned', dueAt: '2026-10-27T12:00:00.000Z' });
  const before = dueReminders([t, own], DEMO_FAMILY, '2026-10-27T11:00:00.000Z');
  assert.equal(before.messages.length, 0);
  const gentle = dueReminders([t, own], DEMO_FAMILY, '2026-10-27T11:31:00.000Z');
  assert.equal(gentle.messages.length, 1);
  assert.equal(gentle.messages[0].lang, 'tl');
  assert.equal(gentle.updates[0].level, 1);
  t.reminderLevel = 1;
  const humor = dueReminders([t, own], DEMO_FAMILY, '2026-10-27T12:16:00.000Z');
  assert.equal(humor.updates[0].level, 2);
  t.reminderLevel = 2;
  const board = dueReminders([t, own], DEMO_FAMILY, '2026-10-27T13:01:00.000Z');
  assert.equal(board.updates[0].level, 3);
  assert.ok(board.messages.every(m => m.toId !== 'mum'));
});

test('weekly fairness ledger and suggestion', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY);
  for (const [i, who, min] of [[1, 'mum', 120], [2, 'mum', 90], [3, 'dad', 30], [4, 'son', 10]] as const) {
    const t = mkTask({ id: 'f' + i, assigneeId: who, status: 'assigned', minutes: min, candidateIds: [who] });
    await store.saveTask(t);
    await markDone(store, t.id, who, NOW);
  }
  const rows = weeklyLedger(await store.members(), await store.tasks(), NOW);
  assert.equal(rows.find(r => r.memberId === 'mum')!.minutes, 210);
  assert.equal(rows.find(r => r.memberId === 'son')!.points, 10);
  assert.match(balanceSuggestion(rows, 'ru'), /Лена.*больше.*Алексей/);
});

test('tick sends reminders and bumps levels', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY);
  await store.saveTask(mkTask({ id: 'k1', assigneeId: 'son', status: 'accepted', dueAt: '2026-10-27T12:00:00.000Z', text: 'полить цветы' }));
  const sent = await tick(store, '2026-10-27T12:20:00.000Z');
  assert.equal(sent.length, 1);
  assert.equal((await store.tasks())[0].reminderLevel, 2); // 20 min overdue → jumps straight to the humorous step
});

/* ---- agent loop with scripted model ---- */
function scripted(responses: ModelResponse[]): ModelClient { let i = 0; return { create: async () => responses[Math.min(i++, responses.length - 1)] }; }

test('dispatch loop: three tasks, right people, helper in Tagalog, child gets a quest; model cannot assign a blocked member', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })));
  const client = scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'get_family', input: {} }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c2', name: 'propose_tasks', input: { tasks: [
      { text: 'Забрать Машу из сада', due_at: '2026-10-27T13:00:00+00:00', minutes: 40, skills: ['drive'], kid_safe: false },
      { text: 'Купить молоко', due_at: '2026-10-27T12:00:00+00:00', minutes: 20, skills: ['shop'], kid_safe: false },
      { text: 'Полить цветы', minutes: 10, skills: ['water_plants'], kid_safe: true },
    ] } }] },
    // tries to give the pickup to the 10-year-old → must be rejected
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c3', name: 'assign', input: { task_id: 'PLACEHOLDER', member_id: 'son', reason: 'he is free', message: 'Тимур, забери Машу' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  ]);
  // patch task ids after propose: wrap client to substitute real ids
  let ids: string[] = [];
  const wrapped: ModelClient = { create: async req => {
    const res = await client.create(req);
    const last = req.messages[req.messages.length - 1] as any;
    if (Array.isArray(last?.content)) for (const b of last.content) if (b.type === 'tool_result') { try { const j = JSON.parse(b.content); if (j.tasks) ids = j.tasks.map((t: any) => t.task_id); } catch {} }
    for (const b of res.content) if (b.type === 'tool_use' && (b.input as any).task_id === 'PLACEHOLDER') (b.input as any).task_id = ids[0];
    return res;
  } };
  const res = await runDispatch(wrapped, store, 'mum', 'Машу забрать в 17:00, купить молоко, полить цветы. Мой номер +971 50 111 2233', { now: NOW });
  assert.equal(res.redactions, 1);
  assert.equal(res.tasks.length, 3);
  const assignErr = res.trace.find(s => s.tool === 'assign')!.output as any;
  assert.match(assignErr.error, /not an allowed candidate/);
  // allowed lists are sane
  const proposed = res.trace.find(s => s.tool === 'propose_tasks')!.output as any;
  const pickup = proposed.tasks[0], milk = proposed.tasks[1], flowers = proposed.tasks[2];
  assert.ok(pickup.allowed.every((c: any) => ['mum', 'dad'].includes(c.member_id)));
  assert.equal(milk.allowed[0].member_id, 'joy');         // household chore in working hours
  assert.ok(flowers.allowed.some((c: any) => c.member_id === 'son'));
  assert.ok(flowers.blocked.some((b: any) => b.memberId === 'masha'));
});
