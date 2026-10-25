/**
 * Tests for Agent Architecture: 4 Pillars
 *  - Pillar 1: Memory & Learning (pattern detection)
 *  - Pillar 2: Multi-step Reasoning (plan_sequence tool)
 *  - Pillar 3: Tool Use (set_reminder, reminder delivery)
 *  - Pillar 4: Autonomous Loops (insights, morning briefing, overload warnings)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FAMILY } from '../src/domovoy/fixtures';
import { InMemoryDomovoyStore } from '../src/domovoy/store';
import { detectPatterns, patternContext } from '../src/domovoy/memory';
import { tick } from '../src/domovoy/household';
import type { Task, TaskEvent, Reminder, Pattern, Insight } from '../src/domovoy/types';

const NOW = '2026-10-27T11:00:00.000Z'; // Tuesday 15:00 Dubai
const t2 = (x: string) => new Date(x).getTime();

function mkStore(opts?: { mode?: 'classic' | 'quest'; tz?: string }) {
  return new InMemoryDomovoyStore([...DEMO_FAMILY], {
    householdId: 'h1', tz: opts?.tz ?? 'Asia/Dubai', mode: opts?.mode ?? 'classic',
  });
}

function mkTask(p: Partial<Task>): Task {
  return {
    id: 't1', authorId: 'mum', text: 'test', minutes: 15, skills: [],
    kidSafe: false, candidateIds: [], declinedBy: [], status: 'new',
    reminderLevel: 0, createdAt: NOW, ...p,
  };
}

// ──────────── Pillar 1: Memory & Learning ────────────

test('detectPatterns: decline_time detects peak decline hours', async () => {
  const store = mkStore();
  // Create tasks declined at 15:00 Dubai (11:00Z) by dad
  for (let i = 0; i < 3; i++) {
    const t = mkTask({ id: `t${i}`, assigneeId: 'dad', assignedAt: NOW, status: 'declined' });
    await store.saveTask(t);
    await store.event({
      at: `2026-10-${20 + i}T11:00:00.000Z`, taskId: t.id, actor: 'dad', type: 'declined',
    });
  }
  const patterns = await detectPatterns(store, NOW);
  const declineTime = patterns.find(p => p.memberId === 'dad' && p.patternType === 'decline_time');
  assert.ok(declineTime, 'should detect decline_time pattern');
  assert.ok((declineTime!.data.hours as number[]).includes(15), 'should detect 15:00 as decline hour');
});

test('detectPatterns: completion_rate computed correctly', async () => {
  const store = mkStore();
  // dad: 7 done, 3 declined = 70% rate
  for (let i = 0; i < 7; i++) {
    await store.saveTask(mkTask({
      id: `done${i}`, assigneeId: 'dad', status: 'done', doneAt: `2026-10-${20 + i}T12:00:00.000Z`,
    }));
  }
  for (let i = 0; i < 3; i++) {
    await store.saveTask(mkTask({ id: `dec${i}`, status: 'declined' }));
    await store.event({
      at: `2026-10-${20 + i}T11:00:00.000Z`, taskId: `dec${i}`, actor: 'dad', type: 'declined',
    });
  }
  const patterns = await detectPatterns(store, NOW);
  const rate = patterns.find(p => p.memberId === 'dad' && p.patternType === 'completion_rate');
  assert.ok(rate, 'should detect completion_rate');
  assert.equal(rate!.data.rate, 0.7);
});

test('detectPatterns: recurring_task detects repeated tasks', async () => {
  const store = mkStore();
  for (let i = 0; i < 4; i++) {
    await store.saveTask(mkTask({
      id: `r${i}`, text: 'buy milk', authorId: 'mum', skills: ['shop'],
      createdAt: `2026-10-${20 + i}T10:00:00.000Z`,
    }));
  }
  const patterns = await detectPatterns(store, NOW);
  const rec = patterns.find(p => p.patternType === 'recurring_task');
  assert.ok(rec, 'should detect recurring_task');
  assert.equal(rec!.data.count, 4);
});

test('detectPatterns: pair_affinity when two members complete tasks together', async () => {
  const store = mkStore();
  // mum assigns to dad, 4 done tasks
  for (let i = 0; i < 4; i++) {
    await store.saveTask(mkTask({
      id: `pair${i}`, authorId: 'mum', assigneeId: 'dad', status: 'done',
      doneAt: `2026-10-${20 + i}T12:00:00.000Z`,
    }));
  }
  const patterns = await detectPatterns(store, NOW);
  const affinity = patterns.find(p => p.patternType === 'pair_affinity');
  assert.ok(affinity, 'should detect pair_affinity');
  assert.equal(affinity!.data.doneCount, 4);
});

test('patternContext builds summary only for patterns with confidence >= 0.3', async () => {
  const store = mkStore();
  // Save patterns with different confidence levels
  await store.savePattern({
    householdId: 'h1', memberId: 'dad', patternType: 'decline_time',
    data: { hours: [15] }, confidence: 0.5, observedCount: 5,
    firstSeen: NOW, lastSeen: NOW, active: true,
  });
  await store.savePattern({
    householdId: 'h1', memberId: 'mum', patternType: 'response_speed',
    data: { avgMinutes: 3 }, confidence: 0.1, observedCount: 1, // too low
    firstSeen: NOW, lastSeen: NOW, active: true,
  });
  const ctx = await patternContext(store);
  assert.ok(ctx.includes('dad'), 'should include dad (confidence 0.5)');
  assert.ok(!ctx.includes('mum'), 'should not include mum (confidence 0.1)');
  assert.ok(ctx.includes('15'), 'should mention decline hour');
});

// ──────────── Pillar 2: Multi-step Reasoning ────────────

test('store: savePlan and plans retrieval', async () => {
  const store = mkStore();
  await store.savePlan({
    id: 'plan_1', householdId: 'h1', triggerText: 'organize party',
    authorId: 'mum', status: 'planning', createdAt: NOW, data: {},
    steps: [
      { step: 1, tool: 'get_family', args: {}, status: 'pending' },
      { step: 2, tool: 'propose_tasks', args: { text: 'buy cake' }, status: 'pending' },
    ],
  });
  const plans = await store.plans();
  assert.equal(plans.length, 1);
  assert.equal(plans[0].id, 'plan_1');
  assert.equal(plans[0].steps.length, 2);
});

// ──────────── Pillar 3: Tool Use — Reminders ────────────

test('store: saveReminder and pending filter', async () => {
  const store = mkStore();
  await store.saveReminder({
    id: 'rem_1', householdId: 'h1', memberId: 'dad', text: 'Take medicine',
    remindAt: '2026-10-27T14:00:00.000Z', status: 'pending', createdAt: NOW,
  });
  await store.saveReminder({
    id: 'rem_2', householdId: 'h1', memberId: 'mum', text: 'Call doctor',
    remindAt: '2026-10-28T09:00:00.000Z', status: 'sent', createdAt: NOW,
  });
  const all = await store.reminders();
  assert.equal(all.length, 2);
  const pending = await store.reminders({ pending: true });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'rem_1');
  const byDad = await store.reminders({ memberId: 'dad' });
  assert.equal(byDad.length, 1);
});

test('tick delivers pending reminders that are due', async () => {
  const store = mkStore();
  // Reminder due before NOW
  await store.saveReminder({
    id: 'rem_due', householdId: 'h1', memberId: 'dad', text: 'Take pills',
    remindAt: '2026-10-27T10:00:00.000Z', status: 'pending', createdAt: NOW,
  });
  // Reminder NOT yet due
  await store.saveReminder({
    id: 'rem_future', householdId: 'h1', memberId: 'mum', text: 'Call later',
    remindAt: '2026-10-28T10:00:00.000Z', status: 'pending', createdAt: NOW,
  });
  const sent = await tick(store, NOW);
  const remSent = sent.filter(s => s.kind === 'scheduled_reminder');
  assert.equal(remSent.length, 1, 'should deliver only the due reminder');
  assert.equal(remSent[0].toId, 'dad');

  // Check the reminder was marked as sent
  const pending = await store.reminders({ pending: true });
  assert.equal(pending.length, 1, 'only future reminder should remain pending');
  assert.equal(pending[0].id, 'rem_future');
});

test('tick reschedules recurring reminders', async () => {
  const store = mkStore();
  await store.saveReminder({
    id: 'rem_daily', householdId: 'h1', memberId: 'dad', text: 'Morning pills',
    remindAt: '2026-10-27T05:00:00.000Z', recurring: 'daily', status: 'pending', createdAt: NOW,
  });
  await tick(store, NOW);
  // Should still be pending but with a new date
  const rems = await store.reminders({ pending: true });
  assert.equal(rems.length, 1);
  assert.ok(rems[0].remindAt > NOW, 'should be rescheduled to future');
  // Check it's 1 day later
  const diff = t2(rems[0].remindAt) - t2('2026-10-27T05:00:00.000Z');
  assert.equal(diff, 86_400_000, 'should be exactly 1 day later');
});

// ──────────── Pillar 4: Autonomous Loops — Insights ────────────

test('tick generates morning briefing between 7-9 AM', async () => {
  const store = mkStore();
  // Add some open tasks
  await store.saveTask(mkTask({ id: 't1', status: 'assigned', assigneeId: 'dad', dueAt: '2026-10-27T08:00:00.000Z' }));
  await store.saveTask(mkTask({ id: 't2', status: 'new' }));

  // 8AM Dubai = 04:00Z
  const morningNow = '2026-10-27T04:00:00.000Z';
  await tick(store, morningNow);

  const insights = await store.insights();
  const briefing = insights.find(i => i.insightType === 'morning_briefing');
  assert.ok(briefing, 'should generate morning briefing');
  assert.ok(briefing!.delivered, 'should mark as delivered');

  // Check outbox has the message
  const outbox = await store.outbox();
  const briefingMsg = outbox.find(m => m.text.includes('morning') || m.text.includes('утро'));
  assert.ok(briefingMsg, 'should send briefing message');
});

test('tick generates overload warning when member near daily limit', async () => {
  const store = mkStore();
  const day = '2026-10-27';
  // dad has dailyLimit 6, need 5 open tasks (80% of 6 = 4.8 → 5 >= 4.8)
  for (let i = 0; i < 5; i++) {
    await store.saveTask(mkTask({
      id: `load${i}`, assigneeId: 'dad', status: 'assigned',
      dueAt: `${day}T${12 + i}:00:00.000Z`,
    }));
  }
  // 8AM Dubai = 04:00Z
  const morningNow = '2026-10-27T04:00:00.000Z';
  await tick(store, morningNow);

  const insights = await store.insights();
  const overload = insights.find(i => i.insightType === 'overload_warning' && i.targetMemberId === 'dad');
  assert.ok(overload, 'should generate overload warning for dad');
});

test('tick does not duplicate morning briefing on second run same day', async () => {
  const store = mkStore();
  await store.saveTask(mkTask({ id: 't1', status: 'new' }));

  const morningNow = '2026-10-27T04:00:00.000Z';
  await tick(store, morningNow);
  await tick(store, '2026-10-27T04:30:00.000Z');

  const insights = await store.insights();
  const briefings = insights.filter(i => i.insightType === 'morning_briefing');
  // One per admin, but not duplicated from second tick
  const uniqueAdmins = new Set(briefings.map(i => i.targetMemberId));
  assert.equal(briefings.length, uniqueAdmins.size, 'no duplicate briefings');
});

test('store: insights filtering by delivered status', async () => {
  const store = mkStore();
  await store.saveInsight({
    householdId: 'h1', insightType: 'morning_briefing', targetMemberId: 'mum',
    data: {}, delivered: false, createdAt: NOW,
  });
  await store.saveInsight({
    householdId: 'h1', insightType: 'overload_warning', targetMemberId: 'dad',
    data: {}, delivered: true, createdAt: NOW,
  });
  const undelivered = await store.insights({ delivered: false });
  assert.equal(undelivered.length, 1);
  assert.equal(undelivered[0].insightType, 'morning_briefing');

  const delivered = await store.insights({ delivered: true });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].insightType, 'overload_warning');
});

test('streak alert in quest mode for children with 5+ day streaks', async () => {
  const store = mkStore({ mode: 'quest' });
  // Give son 5 consecutive days of completed tasks
  for (let i = 0; i < 5; i++) {
    await store.saveTask(mkTask({
      id: `streak${i}`, assigneeId: 'son', status: 'done',
      doneAt: `2026-10-${22 + i}T12:00:00.000Z`,
    }));
  }
  const morningNow = '2026-10-27T04:00:00.000Z';
  await tick(store, morningNow);

  const insights = await store.insights();
  const streak = insights.find(i => i.insightType === 'streak_alert' && i.targetMemberId === 'son');
  assert.ok(streak, 'should generate streak alert for son');
  assert.equal(streak!.data.streakDays, 5);
});
