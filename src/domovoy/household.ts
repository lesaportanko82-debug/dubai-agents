/**
 * Code-only household operations: accept / decline / swap / done / reminder tick / weekly report.
 * No model involved — these must be predictable.
 */
import type { DomovoyStore } from './store';
import type { Lang, Member, Task } from './types';
import { rankCandidates, type AssignContext } from './tools/assign';
import { dueReminders } from './tools/reminders';
import { balanceSuggestion, weeklyLedger, weekBounds } from './tools/fairness';

export async function buildContext(store: DomovoyStore, nowIso: string, tz = 'Asia/Dubai'): Promise<AssignContext> {
  const [members, tasks] = await Promise.all([store.members(), store.tasks()]);
  const { start, end } = weekBounds(nowIso);
  const weekMinutes: Record<string, number> = {};
  const openToday: Record<string, number> = {};
  const day = nowIso.slice(0, 10);
  for (const m of members) {
    weekMinutes[m.id] = tasks.filter(t => t.assigneeId === m.id && t.status === 'done' && t.doneAt && t.doneAt >= start && t.doneAt < end).reduce((s, t) => s + t.minutes, 0);
    openToday[m.id] = tasks.filter(t => t.assigneeId === m.id && ['assigned', 'accepted'].includes(t.status) && (t.dueAt ?? t.createdAt).slice(0, 10) === day).length;
  }
  return { now: nowIso, tz, weekMinutes, openToday };
}

const ASSIGN_TEXT: Record<Lang, (t: Task, m: Member) => string> = {
  ru: (t, m) => m.role === 'child' ? `⭐ Квест для ${m.name}: «${t.text}»${t.dueAt ? ' до ' + hhmm(t.dueAt) : ''}. +10 очков. Напиши «готово», когда сделаешь.` : `${m.name}, дело: ${t.text}${t.dueAt ? ' к ' + hhmm(t.dueAt) : ''}${t.place ? ', ' + t.place : ''}. Ответь «ок» или «не могу».`,
  en: (t, m) => m.role === 'child' ? `⭐ Quest for ${m.name}: "${t.text}"${t.dueAt ? ' by ' + hhmm(t.dueAt) : ''}. +10 points. Reply "done" when finished.` : `${m.name}, task: ${t.text}${t.dueAt ? ' by ' + hhmm(t.dueAt) : ''}${t.place ? ', ' + t.place : ''}. Reply "ok" or "can't".`,
  tl: (t, m) => `${m.name}, gawain: ${t.text}${t.dueAt ? ' bago mag-' + hhmm(t.dueAt) : ''}${t.place ? ', ' + t.place : ''}. Sagutin ng "ok" o "hindi ko kaya".`,
  ar: (t, m) => `${m.name}، مهمة: ${t.text}${t.dueAt ? ' قبل ' + hhmm(t.dueAt) : ''}.`,
  tr: (t, m) => `${m.name}, görev: ${t.text}${t.dueAt ? ' ' + hhmm(t.dueAt) + "'e kadar" : ''}.`,
  hi: (t, m) => `${m.name}, काम: ${t.text}${t.dueAt ? ' ' + hhmm(t.dueAt) + ' तक' : ''}.`,
};
export const hhmm = (iso: string, tz = 'Asia/Dubai') => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

export async function assignTask(store: DomovoyStore, task: Task, memberId: string, reason: string, nowIso: string, message?: string) {
  const members = await store.members();
  const m = members.find(x => x.id === memberId);
  if (!m) throw new Error('unknown member');
  if (!task.candidateIds.includes(memberId)) throw new Error(`${memberId} is not an allowed candidate; allowed: ${task.candidateIds.join(', ') || 'none'}`);
  task.assigneeId = memberId;
  task.status = 'assigned';
  task.assignReason = reason;
  task.reminderLevel = 0;
  await store.saveTask(task);
  await store.event({ at: nowIso, taskId: task.id, actor: 'agent', type: 'assigned', details: { to: memberId, reason } });
  const text = message?.trim() || (ASSIGN_TEXT[m.lang] ?? ASSIGN_TEXT.en)(task, m);
  await store.send({ at: nowIso, toId: m.id, lang: m.lang, text, kind: 'assignment', taskId: task.id });
  return task;
}

/** accept / decline from the assignee. On decline → swap to the next allowed candidate. */
export async function respond(store: DomovoyStore, taskId: string, memberId: string, answer: 'accept' | 'decline', nowIso: string) {
  const tasks = await store.tasks();
  const t = tasks.find(x => x.id === taskId);
  if (!t) throw new Error('unknown task');
  if (t.assigneeId !== memberId) throw new Error('not the assignee');

  if (answer === 'accept') {
    t.status = 'accepted';
    await store.saveTask(t);
    await store.event({ at: nowIso, taskId, actor: memberId, type: 'accepted' });
    return { task: t, swappedTo: undefined as string | undefined };
  }

  t.declinedBy.push(memberId);
  await store.event({ at: nowIso, taskId, actor: memberId, type: 'declined' });
  const members = await store.members();
  const ctx = await buildContext(store, nowIso);
  const { allowed } = rankCandidates(members, { ...t, assigneeId: undefined }, ctx);
  t.candidateIds = allowed.map(c => c.memberId);
  if (!allowed.length) {
    t.assigneeId = undefined;
    t.status = 'unassigned';
    await store.saveTask(t);
    const author = members.find(m => m.id === t.authorId)!;
    await store.send({ at: nowIso, toId: author.id, lang: author.lang, text: author.lang === 'ru' ? `Никто не может взять «${t.text}». Решите, перенести или отменить.` : `Nobody can take "${t.text}". Decide: move it or cancel.`, kind: 'info', taskId });
    return { task: t, swappedTo: undefined };
  }
  const next = allowed[0];
  await assignTask(store, t, next.memberId, `swap after ${memberId} declined: ${next.reasons.join(', ')}`, nowIso);
  await store.event({ at: nowIso, taskId, actor: 'agent', type: 'swapped', details: { from: memberId, to: next.memberId } });
  return { task: t, swappedTo: next.memberId };
}

export async function markDone(store: DomovoyStore, taskId: string, memberId: string, nowIso: string) {
  const t = (await store.tasks()).find(x => x.id === taskId);
  if (!t) throw new Error('unknown task');
  t.status = 'done';
  t.doneAt = nowIso;
  await store.saveTask(t);
  await store.event({ at: nowIso, taskId, actor: memberId, type: 'done' });
  return t;
}

/** Called by a scheduler every few minutes. */
export async function tick(store: DomovoyStore, nowIso: string) {
  const [tasks, members] = await Promise.all([store.tasks(), store.members()]);
  const { messages, updates } = dueReminders(tasks, members, nowIso);
  for (const u of updates) {
    const t = tasks.find(x => x.id === u.taskId)!;
    t.reminderLevel = u.level;
    await store.saveTask(t);
    await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'reminded', details: { level: u.level } });
  }
  for (const m of messages) await store.send(m);
  return messages;
}

export async function weeklyReport(store: DomovoyStore, refIso: string, lang: 'ru' | 'en' = 'ru') {
  const [members, tasks] = await Promise.all([store.members(), store.tasks()]);
  const rows = weeklyLedger(members, tasks, refIso);
  return { rows, suggestion: balanceSuggestion(rows, lang) };
}
