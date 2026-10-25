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

/* ---- resilience: silence, reschedule, urgent, declines, proof, "not about themselves" ---- */

test('task about a person is never assigned to that person', () => {
  const clinic = mkTask({ skills: ['drive', 'pickup_walk'], aboutMemberId: 'granny', dueAt: '2026-10-28T05:00:00.000Z' });
  const { allowed, blocked } = rankCandidates(DEMO_FAMILY, clinic, { now: NOW, weekMinutes: {}, openToday: {} });
  assert.ok(!allowed.some(c => c.memberId === 'granny'));
  assert.ok(blocked.some(b => b.memberId === 'granny' && b.reason === 'the task is about this person'));
});

test('silence longer than the timeout counts as a decline and the task moves on', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })));
  const t = mkTask({ id: 'q1', skills: ['shop'], dueAt: '2026-10-27T14:00:00.000Z', candidateIds: ['dad', 'joy', 'mum'] });
  await store.saveTask(t);
  await assignTask(store, t, 'dad', 'test', NOW);
  await tick(store, '2026-10-27T11:30:00.000Z'); // 30 min: still waiting
  assert.equal((await store.tasks())[0].assigneeId, 'dad');
  const sent = await tick(store, '2026-10-27T11:50:00.000Z'); // 50 min: timeout
  const after = (await store.tasks())[0];
  assert.notEqual(after.assigneeId, 'dad');
  assert.ok(after.declinedBy.includes('dad'));
  assert.ok(sent.some(s => s.kind === 'timeout'));
  assert.ok((await store.events()).some(e => e.type === 'timeout'));
});

test('decline with a proposed time reschedules instead of swapping (non-urgent only)', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY);
  const t = mkTask({ id: 'q2', skills: ['laundry'], dueAt: '2026-10-27T13:00:00.000Z', candidateIds: ['dad', 'joy'] });
  await store.saveTask(t);
  await assignTask(store, t, 'dad', 'test', NOW);
  const r = await respond(store, 'q2', 'dad', 'decline', NOW, { proposeAt: '2026-10-27T15:00:00.000Z' });
  assert.equal(r.rescheduled, true);
  assert.equal(r.task.assigneeId, 'dad');
  assert.equal(r.task.status, 'accepted');
  assert.equal(r.task.dueAt, '2026-10-27T15:00:00.000Z');
  assert.ok((await store.outbox()).some(m => m.toId === 'mum' && /15:00|19:00/.test(m.text))); // author informed (Dubai time shown)

  const u = mkTask({ id: 'q3', urgent: true, skills: ['drive'], dueAt: '2026-10-27T13:00:00.000Z', candidateIds: ['dad', 'mum'] });
  await store.saveTask(u);
  await assignTask(store, u, 'dad', 'test', NOW);
  const r2 = await respond(store, 'q3', 'dad', 'decline', NOW, { proposeAt: '2026-10-27T15:00:00.000Z' });
  assert.equal(r2.rescheduled, false);
  assert.equal(r2.swappedTo, 'mum'); // urgent: no rescheduling, straight to the next person
});

test('urgent task without confirmation close to due time is auto-replaced', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })));
  const t = mkTask({ id: 'q4', urgent: true, skills: ['drive', 'pickup_walk'], dueAt: '2026-10-27T12:00:00.000Z', candidateIds: ['dad', 'granny', 'mum'] });
  await store.saveTask(t);
  await assignTask(store, t, 'dad', 'test', '2026-10-27T11:30:00.000Z');
  const sent = await tick(store, '2026-10-27T11:45:00.000Z'); // 15 min before due, dad silent
  const after = (await store.tasks())[0];
  assert.notEqual(after.assigneeId, 'dad');
  assert.ok(sent.some(s => s.kind === 'auto_replace'));
  assert.ok((await store.outbox()).some(m => m.toId === 'dad' && /передаю другому|handing it over/.test(m.text)));
});

test('frequent decliners get offered first next time', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY);
  await store.event({ at: NOW, taskId: 'x', actor: 'dad', type: 'declined' });
  await store.event({ at: NOW, taskId: 'y', actor: 'dad', type: 'declined' });
  const ctx = await buildContext(store, NOW);
  assert.equal(ctx.weekDeclines?.dad, 2);
  const { allowed } = rankCandidates(DEMO_FAMILY, mkTask({ skills: ['shop'], dueAt: '2026-10-27T11:00:00.000Z' }), ctx); // 15:00 Dubai: within default hours, helper may be off
  assert.equal(allowed[0].memberId, 'dad');
  assert.ok(allowed[0].reasons.includes('declined earlier this week, their turn'));
});

test('tasks that need proof stay open until a photo arrives', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY);
  const t = mkTask({ id: 'q5', needsProof: true, assigneeId: 'son', status: 'accepted', skills: ['water_plants'], kidSafe: true, candidateIds: ['son'] });
  await store.saveTask(t);
  const r1 = await markDone(store, 'q5', 'son', NOW);
  assert.equal(r1.needProof, true);
  assert.equal(r1.task.status, 'accepted');
  assert.ok((await store.outbox()).some(m => m.toId === 'son' && /фото|photo/.test(m.text)));
  const r2 = await markDone(store, 'q5', 'son', NOW, { proofUrl: 'photos/q5.jpg' });
  assert.equal(r2.task.status, 'done');
  assert.equal(r2.task.proofUrl, 'photos/q5.jpg');
});

// ---------- P2: Anti-farming, duplicate detection, mutual assignment, goal auto-adjust ----------
import { MIN_MINUTES_FOR_POINTS, DAILY_POINTS_CAP } from '../src/domovoy/tools/fairness';
import type { Goal } from '../src/domovoy/types';

test('P2.1 anti-farming: tasks < 5 min earn no points; daily cap is 50', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY);
  const day = NOW.slice(0, 10);
  // Create 7 tasks for son, some < 5 min
  const tasks = [
    mkTask({ id: 'af1', assigneeId: 'son', status: 'assigned', minutes: 3, kidSafe: true, candidateIds: ['son'] }),  // < 5min: no points
    mkTask({ id: 'af2', assigneeId: 'son', status: 'assigned', minutes: 10, kidSafe: true, candidateIds: ['son'] }), // 10 pts
    mkTask({ id: 'af3', assigneeId: 'son', status: 'assigned', minutes: 5, kidSafe: true, candidateIds: ['son'] }),  // 10 pts
    mkTask({ id: 'af4', assigneeId: 'son', status: 'assigned', minutes: 15, kidSafe: true, candidateIds: ['son'] }), // 10 pts
    mkTask({ id: 'af5', assigneeId: 'son', status: 'assigned', minutes: 10, kidSafe: true, candidateIds: ['son'] }), // 10 pts
    mkTask({ id: 'af6', assigneeId: 'son', status: 'assigned', minutes: 10, kidSafe: true, candidateIds: ['son'] }), // 10 pts → total 50 → cap
    mkTask({ id: 'af7', assigneeId: 'son', status: 'assigned', minutes: 10, kidSafe: true, candidateIds: ['son'] }), // would be 60 but capped at 50
  ];
  for (const t of tasks) { await store.saveTask(t); await markDone(store, t.id, 'son', NOW); }
  const rows = weeklyLedger(await store.members(), await store.tasks(), NOW);
  const son = rows.find(r => r.memberId === 'son')!;
  assert.equal(son.points, DAILY_POINTS_CAP); // capped at 50, and af1 (3 min) earned nothing
  assert.equal(son.tasks, 7); // all 7 tasks counted for minutes
  assert.equal(MIN_MINUTES_FOR_POINTS, 5);
});

test('P2.1 anti-farming: child self-tasks in quest mode → auto needsProof', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })), { mode: 'quest' });
  const client = scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'get_family', input: {} }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c2', name: 'propose_tasks', input: { tasks: [
      { text: 'Полить цветы', minutes: 10, skills: ['water_plants'], kid_safe: true },
    ] } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  ]);
  const res = await runDispatch(client, store, 'son', 'Хочу полить цветы', { now: NOW, mode: 'quest' });
  assert.equal(res.tasks[0].needsProof, true);
});

test('P2.2 duplicate detection: warns when similar active task exists', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })));
  // Pre-create a task
  const existing = mkTask({ id: 'dup1', text: 'Купить молоко', skills: ['shop'], status: 'assigned', assigneeId: 'joy', createdAt: NOW });
  await store.saveTask(existing);
  const client = scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'get_family', input: {} }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c2', name: 'propose_tasks', input: { tasks: [
      { text: 'Купить молоко', minutes: 20, skills: ['shop'], kid_safe: false },
    ] } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'duplicate noted' }] },
  ]);
  const res = await runDispatch(client, store, 'mum', 'Купить молоко', { now: NOW });
  // The propose_tasks result should contain a duplicate_warning
  const proposeResult = res.trace.find(s => s.tool === 'propose_tasks')!.output as any;
  assert.ok(proposeResult.tasks[0].duplicate_warning);
  assert.match(proposeResult.tasks[0].duplicate_warning, /Similar active task/);
});

test('P2.3 mutual assignment: warns both when A→B and B→A within 5 min', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [] })));
  // First: dad assigns a task to mum (simulate with direct save)
  const t1 = mkTask({ id: 'mut1', authorId: 'dad', assigneeId: 'mum', assignedAt: NOW, status: 'assigned', skills: ['cook'], candidateIds: ['mum'] });
  await store.saveTask(t1);
  // Now mum dispatches and assigns to dad within 5 min
  const twoMinLater = new Date(new Date(NOW).getTime() + 2 * 60_000).toISOString();
  let assignedTaskId = '';
  const client = scripted([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c1', name: 'get_family', input: {} }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c2', name: 'propose_tasks', input: { tasks: [
      { text: 'Починить кран', minutes: 30, skills: ['repair'], kid_safe: false },
    ] } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c3', name: 'assign', input: { task_id: 'PLACEHOLDER', member_id: 'dad', reason: 'he can repair', message: 'Алексей, почини кран' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  ]);
  let ids: string[] = [];
  const wrapped: ModelClient = { create: async req => {
    const res = await client.create(req);
    const last = req.messages[req.messages.length - 1] as any;
    if (Array.isArray(last?.content)) for (const b of last.content) if (b.type === 'tool_result') { try { const j = JSON.parse(b.content); if (j.tasks) ids = j.tasks.map((t: any) => t.task_id); } catch {} }
    for (const b of res.content) if (b.type === 'tool_use' && (b.input as any).task_id === 'PLACEHOLDER') (b.input as any).task_id = ids[0];
    return res;
  } };
  const res = await runDispatch(wrapped, store, 'mum', 'Алексей, почини кран', { now: twoMinLater });
  // Check that mutual assignment warning messages were sent
  const outbox = await store.outbox();
  const mutualMsgs = outbox.filter(m => /назначили дела друг другу|assigned tasks to each other/.test(m.text));
  assert.ok(mutualMsgs.length >= 2, 'both parties should get a mutual assignment warning');
  // The assign result should have the warning flag
  const assignResult = res.trace.find(s => s.tool === 'assign')?.output as any;
  assert.equal(assignResult?.mutual_assignment_warning, true);
});

test('P2.4 goal difficulty auto-adjustment: warns admin when goal progress < 50% with 2 days left', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY);
  const twoDaysFromNow = new Date(new Date(NOW).getTime() + 1.5 * 86_400_000).toISOString(); // 1.5 days → within 2-day window
  const goal: Goal = {
    id: 'g1', householdId: 'demo', title: 'Полить цветы 10 раз', targetMemberId: 'son',
    type: 'deadline', threshold: 10, reward: 'Поход в кино', progress: 3, // 3/10 = 30% < 50%
    status: 'active', createdAt: NOW,
    updatedAt: NOW, // threshold for deadline = days, so deadline = updatedAt + threshold * 86400000
  };
  await store.saveGoal(goal);

  // Tick at a point where deadline is within 2 days
  // deadline = NOW + 10 days. We need to tick close to the deadline.
  const nearDeadline = new Date(new Date(NOW).getTime() + 8.5 * 86_400_000).toISOString(); // 1.5 days before deadline
  const sent = await tick(store, nearDeadline);
  assert.ok(sent.some(s => s.kind === 'goal_warning'));
  const outbox = await store.outbox();
  assert.ok(outbox.some(m => /Цель|Goal/.test(m.text) && /слишком сложно|too hard/.test(m.text)));

  // Second tick should NOT warn again (already warned)
  const sent2 = await tick(store, nearDeadline);
  assert.ok(!sent2.some(s => s.kind === 'goal_warning'), 'should not warn twice');
});

// ---------- Telegram channel ----------
import { handleUpdate, parseReply, type TgSender, type TgUpdate } from '../src/domovoy/telegram';

function fakeSender() {
  const sent: { chatId: string; text: string; buttons?: string[] }[] = [];
  const s: TgSender = {
    async sendMessage(chatId, text, keyboard) { sent.push({ chatId, text, buttons: keyboard?.flat().map(b => b.data) }); },
    async answerCallback() {}, async clearKeyboard() {},
  };
  return { s, sent };
}
const msgUpd = (chat: number, text: string, id = Math.floor(Math.random() * 1e9)): TgUpdate => ({ update_id: id, message: { message_id: 1, chat: { id: chat, type: 'private' }, date: 0, text, from: { id: chat, language_code: 'ru' } } });
const cbUpd = (chat: number, data: string): TgUpdate => ({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'c', from: { id: chat }, data, message: { message_id: 2, chat: { id: chat, type: 'private' }, date: 0 } } });

test('parseReply understands ok / can’t (+time) / done in RU, EN, TL', () => {
  const now = '2026-10-26T10:00:00.000Z'; // 14:00 Dubai
  assert.equal(parseReply('ок', now).kind, 'accept');
  assert.equal(parseReply('Sige po', now).kind, 'accept');
  assert.equal(parseReply('готово!', now).kind, 'done');
  assert.equal(parseReply('tapos na', now).kind, 'done');
  const d = parseReply('не могу, через 2 часа смогу', now);
  assert.equal(d.kind, 'decline'); assert.equal((d as any).proposeAt, '2026-10-26T12:00:00.000Z');
  const e = parseReply("can't now, at 19:00", now);
  assert.equal((e as any).proposeAt, '2026-10-26T15:00:00.000Z'); // 19:00 Dubai
  assert.equal(parseReply('завтра в 17 забрать Машу', now).kind, 'none');
});

test('telegram: link via /start, assignment delivered with buttons, button accept, unlinked echoed to admin', async () => {
  const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [], telegramId: undefined })));
  const now = new Date().toISOString();
  const { s, sent } = fakeSender();
  const deps = { send: s, now, seen: new Set<number>() };
  await handleUpdate(store, msgUpd(111, '/start'), deps);
  assert.ok(sent.at(-1)!.buttons!.includes('link:mum'));
  await handleUpdate(store, cbUpd(111, 'link:mum'), deps);
  assert.equal((await store.members()).find(m => m.id === 'mum')!.telegramId, '111');
  await handleUpdate(store, msgUpd(222, '/start joy'), deps);
  assert.equal((await store.members()).find(m => m.id === 'joy')!.telegramId, '222');

  // the agent assigns a task to Joy and one to Timur (not linked) — Joy gets buttons, mum gets an echo for Timur
  const t1 = mkTask({ id: 'tg1', text: 'Купить молоко', skills: ['shop'], candidateIds: ['joy'] });
  await store.saveTask(t1); await assignTask(store, t1, 'joy', 'test', now);
  const t2 = mkTask({ id: 'tg2', text: 'Полить цветы', skills: ['water_plants'], kidSafe: true, candidateIds: ['son'] });
  await store.saveTask(t2); await assignTask(store, t2, 'son', 'test', now);
  sent.length = 0;
  await handleUpdate(store, msgUpd(222, 'hello?'), deps); // any traffic flushes nothing new; test flush via a reply instead
  sent.length = 0;
  await handleUpdate(store, cbUpd(222, 'a:tg1'), deps);
  assert.equal((await store.tasks()).find(t => t.id === 'tg1')!.status, 'accepted');
  assert.ok(sent.some(x => x.chatId === '222' && /Принято|Tanggap|Got it/.test(x.text)));

  // plain-text decline with a time → rescheduled, author (mum) informed in her chat
  const t3 = mkTask({ id: 'tg3', text: 'Погладить форму', skills: ['laundry'], candidateIds: ['joy'] });
  await store.saveTask(t3); await assignTask(store, t3, 'joy', 'test', now);
  sent.length = 0;
  await handleUpdate(store, msgUpd(222, 'hindi ko kaya ngayon, in 1 hour'), deps);
  const t3b = (await store.tasks()).find(t => t.id === 'tg3')!;
  assert.equal(t3b.status, 'accepted'); assert.ok(t3b.rescheduledFrom !== undefined || t3b.dueAt);
  assert.ok(sent.some(x => x.chatId === '111'), 'author gets the reschedule notice');

  // duplicate update id is ignored
  const u = msgUpd(222, '/tasks', 42);
  await handleUpdate(store, u, deps); const n = sent.length;
  await handleUpdate(store, u, deps); assert.equal(sent.length, n);
});

test('dueAt collision blocks assignment when tasks overlap', () => {
  const existing: Task[] = [
    mkTask({ id: 'e1', assigneeId: 'dad', status: 'accepted', dueAt: '2026-10-27T12:00:00.000Z', minutes: 30 }),
  ];
  // Task overlapping with existing (± minutes/2 window)
  const overlapping = mkTask({ id: 't2', dueAt: '2026-10-27T12:10:00.000Z', minutes: 20 });
  const r1 = canAssign(by('dad'), overlapping, { now: NOW, openTasksToday: 0, existingTasks: existing });
  assert.equal(r1.ok, false);
  assert.match(r1.reason!, /time collision/);

  // Task that does NOT overlap (well after)
  const noOverlap = mkTask({ id: 't3', dueAt: '2026-10-27T14:00:00.000Z', minutes: 20 });
  const r2 = canAssign(by('dad'), noOverlap, { now: NOW, openTasksToday: 0, existingTasks: existing });
  assert.equal(r2.ok, true);

  // No collision without existingTasks
  const r3 = canAssign(by('dad'), overlapping, { now: NOW, openTasksToday: 0 });
  assert.equal(r3.ok, true);
});

test('rankCandidates passes existingTasks and blocks colliding members', () => {
  const existing: Task[] = [
    mkTask({ id: 'e1', assigneeId: 'dad', status: 'assigned', dueAt: '2026-10-27T12:00:00.000Z', minutes: 30 }),
  ];
  const task = mkTask({ id: 't2', authorId: 'mum', dueAt: '2026-10-27T12:05:00.000Z', minutes: 20 });
  const ctx = { now: NOW, tz: 'Asia/Dubai', weekMinutes: {} as Record<string, number>, openToday: {} as Record<string, number>, existingTasks: existing };
  const { allowed, blocked } = rankCandidates(DEMO_FAMILY, task, ctx);
  // dad should be blocked due to collision
  assert.ok(blocked.some(b => b.memberId === 'dad' && /time collision/.test(b.reason)));
  // dad should NOT be in allowed
  assert.ok(!allowed.some(c => c.memberId === 'dad'));
});
