'use server';
import { revalidatePath } from 'next/cache';
import { domovoyState, demoNow } from '@/lib/domovoy-server';
import { markDone, respond, tick } from '@core/domovoy/household';

export async function respondAction(formData: FormData) {
  const { store } = domovoyState();
  const taskId = String(formData.get('taskId'));
  const memberId = String(formData.get('memberId'));
  const answer = String(formData.get('answer')) as 'accept' | 'decline';
  const proposeIn = Number(formData.get('proposeInMin') ?? 0); // "can't now, can in N minutes"
  const proposeAt = proposeIn > 0 ? new Date(Date.now() + proposeIn * 60_000).toISOString() : undefined;
  try { await respond(store, taskId, memberId, answer, demoNow(), { proposeAt }); } catch { /* ignore stale clicks */ }
  revalidatePath('/domovoy', 'layout');
}

export async function doneAction(formData: FormData) {
  const { store } = domovoyState();
  const withPhoto = formData.get('photo') === '1';
  try { await markDone(store, String(formData.get('taskId')), String(formData.get('memberId')), demoNow(), withPhoto ? { proofUrl: `photos/${formData.get('taskId')}.jpg` } : {}); } catch { /* ignore */ }
  revalidatePath('/domovoy', 'layout');
}

export async function rescheduleAction(formData: FormData) {
  const { store } = domovoyState();
  const taskId = String(formData.get('taskId'));
  const tasks = await store.tasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status !== 'unassigned') return;
  const now = demoNow();
  const tmrw = new Date(Date.parse(now) + 86_400_000);
  if (task.dueAt) { const d = new Date(task.dueAt); d.setDate(d.getDate() + 1); task.dueAt = d.toISOString(); }
  else task.dueAt = tmrw.toISOString();
  task.rescheduledFrom = now; task.status = 'new'; task.declinedBy = []; task.candidateIds = [];
  await store.saveTask(task);
  await store.event({ at: now, taskId: task.id, actor: 'panel', type: 'rescheduled', details: { to: task.dueAt } });
  revalidatePath('/domovoy', 'layout');
}

export async function cancelAction(formData: FormData) {
  const { store } = domovoyState();
  const taskId = String(formData.get('taskId'));
  const tasks = await store.tasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status !== 'unassigned') return;
  const now = demoNow();
  task.status = 'cancelled';
  await store.saveTask(task);
  await store.event({ at: now, taskId: task.id, actor: 'panel', type: 'blocked', details: { reason: 'cancelled from panel' } });
  revalidatePath('/domovoy', 'layout');
}

/** Simulate the scheduler: advance the clock by N minutes past the next due time and send reminders. */
export async function tickAction(formData: FormData) {
  const { store } = domovoyState();
  const plusMin = Number(formData.get('plusMin') ?? 0);
  const at = new Date(Date.now() + plusMin * 60_000).toISOString();
  await tick(store, at);
  revalidatePath('/domovoy', 'layout');
}
