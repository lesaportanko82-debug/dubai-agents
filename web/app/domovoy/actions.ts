'use server';
import { revalidatePath } from 'next/cache';
import { domovoyState, demoNow } from '@/lib/domovoy-server';
import { markDone, respond, tick } from '@core/domovoy/household';

export async function respondAction(formData: FormData) {
  const { store } = domovoyState();
  const taskId = String(formData.get('taskId'));
  const memberId = String(formData.get('memberId'));
  const answer = String(formData.get('answer')) as 'accept' | 'decline';
  try { await respond(store, taskId, memberId, answer, demoNow()); } catch { /* ignore stale clicks */ }
  revalidatePath('/domovoy', 'layout');
}

export async function doneAction(formData: FormData) {
  const { store } = domovoyState();
  try { await markDone(store, String(formData.get('taskId')), String(formData.get('memberId')), demoNow()); } catch { /* ignore */ }
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
