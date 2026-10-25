/**
 * Code-only household operations: accept / decline / swap / done / reminder tick / weekly report.
 * No model involved — these must be predictable.
 */
import type { DomovoyStore } from './store';
import type { Lang, Member, Task } from './types';
import { rankCandidates, type AssignContext } from './tools/assign';
import { dueReminders } from './tools/reminders';
import { balanceSuggestion, weeklyLedger, weekBounds } from './tools/fairness';

/** Policy knobs (per family in production). */
export const POLICY = {
  silenceTimeoutMin: 45,       // no "ok" after this → treated as a decline
  urgentReplaceBeforeMin: 20,  // urgent task not accepted this close to due → auto-replace
  maxRescheduleHours: 24,      // a proposed time must be within this window
};

const t2 = (x: string) => new Date(x).getTime();

export async function buildContext(store: DomovoyStore, nowIso: string, tz = store.tz): Promise<AssignContext> {
  const [members, tasks, events] = await Promise.all([store.members(), store.tasks(), store.events()]);
  const { start, end } = weekBounds(nowIso);
  const weekMinutes: Record<string, number> = {};
  const openToday: Record<string, number> = {};
  const weekDeclines: Record<string, number> = {};
  const day = nowIso.slice(0, 10);
  for (const m of members) {
    weekMinutes[m.id] = tasks.filter(t => t.assigneeId === m.id && t.status === 'done' && t.doneAt && t.doneAt >= start && t.doneAt < end).reduce((s, t) => s + t.minutes, 0);
    openToday[m.id] = tasks.filter(t => t.assigneeId === m.id && ['assigned', 'accepted'].includes(t.status) && (t.dueAt ?? t.createdAt).slice(0, 10) === day).length;
    weekDeclines[m.id] = events.filter(e => (e.type === 'declined' && e.actor === m.id) || (e.type === 'timeout' && e.details?.member === m.id)).filter(e => e.at >= start && e.at < end).length;
  }
  return { now: nowIso, tz, weekMinutes, openToday, weekDeclines };
}

export const hhmm = (iso: string, tz = 'Asia/Dubai') => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

const REPLY_HINT: Record<Lang, string> = { ru: 'Ответь «ок» или «не могу» (можно предложить время: «могу в 19:00»).', en: 'Reply "ok" or "can\'t" (you may suggest a time: "can at 19:00").', tl: 'Sagutin ng "ok" o "hindi ko kaya" (pwede ring magmungkahi ng oras).', ar: 'أجب «حسناً» أو «لا أستطيع».', tr: '"tamam" ya da "yapamam" diye yanıtla.', hi: '"ठीक" या "नहीं कर सकता" जवाब दें।' };

const ASSIGN_TEXT: Record<Lang, (t: Task, m: Member, tz: string) => string> = {
  ru: (t, m, tz) => m.role === 'child'
    ? `⭐ Квест для ${m.name}: «${t.text}»${t.dueAt ? ' до ' + hhmm(t.dueAt, tz) : ''}. +10 очков. Напиши «готово»${t.needsProof ? ' и пришли фото' : ''}, когда сделаешь.`
    : `${m.name}, дело: ${t.text}${t.dueAt ? ' к ' + hhmm(t.dueAt, tz) : ''}${t.place ? ', ' + t.place : ''}.${t.urgent ? ' Срочное.' : ''} ${REPLY_HINT.ru}`,
  en: (t, m, tz) => m.role === 'child'
    ? `⭐ Quest for ${m.name}: "${t.text}"${t.dueAt ? ' by ' + hhmm(t.dueAt, tz) : ''}. +10 points. Reply "done"${t.needsProof ? ' with a photo' : ''} when finished.`
    : `${m.name}, task: ${t.text}${t.dueAt ? ' by ' + hhmm(t.dueAt, tz) : ''}${t.place ? ', ' + t.place : ''}.${t.urgent ? ' Time-critical.' : ''} ${REPLY_HINT.en}`,
  tl: (t, m, tz) => `${m.name}, gawain: ${t.text}${t.dueAt ? ' bago mag-' + hhmm(t.dueAt, tz) : ''}${t.place ? ', ' + t.place : ''}. ${REPLY_HINT.tl}`,
  ar: (t, m, tz) => `${m.name}، مهمة: ${t.text}${t.dueAt ? ' قبل ' + hhmm(t.dueAt, tz) : ''}. ${REPLY_HINT.ar}`,
  tr: (t, m, tz) => `${m.name}, görev: ${t.text}${t.dueAt ? ' ' + hhmm(t.dueAt, tz) + "'e kadar" : ''}. ${REPLY_HINT.tr}`,
  hi: (t, m, tz) => `${m.name}, काम: ${t.text}${t.dueAt ? ' ' + hhmm(t.dueAt, tz) + ' तक' : ''}. ${REPLY_HINT.hi}`,
};

const say = (lang: Lang, ru: string, en: string) => (lang === 'ru' ? ru : en);

export async function assignTask(store: DomovoyStore, task: Task, memberId: string, reason: string, nowIso: string, message?: string) {
  const members = await store.members();
  const m = members.find(x => x.id === memberId);
  if (!m) throw new Error('unknown member');
  if (!task.candidateIds.includes(memberId)) throw new Error(`${memberId} is not an allowed candidate; allowed: ${task.candidateIds.join(', ') || 'none'}`);
  task.assigneeId = memberId;
  task.assignedAt = nowIso;
  task.status = 'assigned';
  task.assignReason = reason;
  task.reminderLevel = 0;
  await store.saveTask(task);
  await store.event({ at: nowIso, taskId: task.id, actor: 'agent', type: 'assigned', details: { to: memberId, reason } });
  const text = message?.trim() || (ASSIGN_TEXT[m.lang] ?? ASSIGN_TEXT.en)(task, m, store.tz);
  await store.send({ at: nowIso, toId: m.id, lang: m.lang, text, kind: 'assignment', taskId: task.id });

  // Soft-limit warning: notify author when assignee is near their daily limit
  const day = nowIso.slice(0, 10);
  const allTasks = await store.tasks();
  const openToday = allTasks.filter(t => t.assigneeId === memberId && ['assigned', 'accepted'].includes(t.status) && (t.dueAt ?? t.createdAt).slice(0, 10) === day).length;
  if (openToday >= m.dailyLimit - 1 && task.authorId !== memberId) {
    const author = members.find(x => x.id === task.authorId);
    if (author) {
      await store.send({ at: nowIso, toId: author.id, lang: author.lang, kind: 'info', taskId: task.id,
        text: say(author.lang,
          `⚠️ ${m.name} сегодня уже ${openToday}/${m.dailyLimit} дел — почти на пределе.`,
          `⚠️ ${m.name} has ${openToday}/${m.dailyLimit} tasks today — near limit.`) });
    }
  }
  return task;
}

/** Re-rank and hand the task to the next allowed person; inform the author only if nobody is left. */
async function swapToNext(store: DomovoyStore, t: Task, from: string, nowIso: string, why: string) {
  const members = await store.members();
  const ctx = await buildContext(store, nowIso);
  ctx.existingTasks = await store.tasks();
  const { allowed } = rankCandidates(members, { ...t, assigneeId: undefined }, ctx);
  t.candidateIds = allowed.map(c => c.memberId);
  if (!allowed.length) {
    t.assigneeId = undefined;
    t.status = 'unassigned';
    await store.saveTask(t);
    const author = members.find(m => m.id === t.authorId)!;
    await store.send({ at: nowIso, toId: author.id, lang: author.lang, kind: 'info', taskId: t.id, text: say(author.lang, `Никто не может взять «${t.text}». Решите: перенести или отменить.`, `Nobody can take "${t.text}". Decide: move it or cancel.`) });
    return undefined;
  }
  const next = allowed[0];
  await assignTask(store, t, next.memberId, `${why}: ${next.reasons.join(', ')}`, nowIso);
  await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'swapped', details: { from, to: next.memberId, why } });
  return next.memberId;
}

/**
 * accept / decline from the assignee.
 * decline + proposed time (non-urgent, within window) → task moved, same person, author informed.
 * decline otherwise → swap to the next allowed candidate.
 */
export async function respond(store: DomovoyStore, taskId: string, memberId: string, answer: 'accept' | 'decline', nowIso: string, opts: { proposeAt?: string } = {}) {
  const tasks = await store.tasks();
  const t = tasks.find(x => x.id === taskId);
  if (!t) throw new Error('unknown task');
  if (t.assigneeId !== memberId) throw new Error('not the assignee');
  const members = await store.members();
  const me = members.find(m => m.id === memberId)!;
  const author = members.find(m => m.id === t.authorId)!;

  if (answer === 'accept') {
    t.status = 'accepted';
    await store.saveTask(t);
    await store.event({ at: nowIso, taskId, actor: memberId, type: 'accepted' });
    return { task: t, swappedTo: undefined as string | undefined, rescheduled: false };
  }

  await store.event({ at: nowIso, taskId, actor: memberId, type: 'declined', details: opts.proposeAt ? { proposeAt: opts.proposeAt } : undefined });

  // "can't now, can at 19:00" — keep the person, move the task (not for urgent tasks)
  if (opts.proposeAt && !t.urgent) {
    const within = t2(opts.proposeAt) > t2(nowIso) && t2(opts.proposeAt) - t2(nowIso) <= POLICY.maxRescheduleHours * 3_600_000;
    if (within) {
      t.rescheduledFrom = t.dueAt;
      t.dueAt = opts.proposeAt;
      t.status = 'accepted';
      t.reminderLevel = 0;
      await store.saveTask(t);
      await store.event({ at: nowIso, taskId, actor: 'agent', type: 'rescheduled', details: { by: memberId, to: opts.proposeAt } });
      await store.send({ at: nowIso, toId: me.id, lang: me.lang, kind: 'info', taskId, text: say(me.lang, `Хорошо, «${t.text}» перенесено на ${hhmm(opts.proposeAt, store.tz)}. Напомню.`, `Fine, "${t.text}" moved to ${hhmm(opts.proposeAt, store.tz)}. I'll remind you.`) });
      if (author.id !== me.id) await store.send({ at: nowIso, toId: author.id, lang: author.lang, kind: 'info', taskId, text: say(author.lang, `${me.name} сделает «${t.text}» в ${hhmm(opts.proposeAt, store.tz)} вместо ${t.rescheduledFrom ? hhmm(t.rescheduledFrom, store.tz) : '—'}.`, `${me.name} will do "${t.text}" at ${hhmm(opts.proposeAt, store.tz)} instead of ${t.rescheduledFrom ? hhmm(t.rescheduledFrom, store.tz) : '—'}.`) });
      return { task: t, swappedTo: undefined, rescheduled: true };
    }
  }

  t.declinedBy.push(memberId);
  const swappedTo = await swapToNext(store, t, memberId, nowIso, `swap after ${memberId} declined`);
  return { task: t, swappedTo, rescheduled: false };
}

/** Close a task. Tasks flagged needsProof require a photo; without it we ask once and keep it open. */
export async function markDone(store: DomovoyStore, taskId: string, memberId: string, nowIso: string, opts: { proofUrl?: string } = {}) {
  const t = (await store.tasks()).find(x => x.id === taskId);
  if (!t) throw new Error('unknown task');
  if (t.needsProof && !opts.proofUrl && !t.proofUrl) {
    const m = (await store.members()).find(x => x.id === memberId)!;
    await store.event({ at: nowIso, taskId, actor: 'agent', type: 'proof_requested', details: { member: memberId } });
    await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'info', taskId, text: say(m.lang, `Супер! Пришли, пожалуйста, фото — и дело закрыто.`, `Great! Send a photo and the task is closed.`) });
    return { task: t, needProof: true };
  }
  if (opts.proofUrl) t.proofUrl = opts.proofUrl;
  t.status = 'done';
  t.doneAt = nowIso;
  await store.saveTask(t);
  await store.event({ at: nowIso, taskId, actor: memberId, type: 'done', details: t.proofUrl ? { proof: t.proofUrl } : undefined });
  return { task: t, needProof: false };
}

/**
 * Scheduler tick (every few minutes):
 *  1. urgent task not accepted and due within N min → auto-replace, both sides informed
 *  2. silence longer than the timeout → treated as decline → swap
 *  3. reminder ladder for the rest
 */
export async function tick(store: DomovoyStore, nowIso: string) {
  const [tasks, members] = await Promise.all([store.tasks(), store.members()]);
  const byId = new Map(members.map(m => [m.id, m]));
  const now = t2(nowIso);
  const sent: { kind: string; toId: string; text: string }[] = [];

  for (const t of tasks) {
    if (t.status !== 'assigned' || !t.assigneeId || !t.assignedAt) continue;
    const silentMin = (now - t2(t.assignedAt)) / 60_000;
    const minsToDue = t.dueAt ? (t2(t.dueAt) - now) / 60_000 : Infinity;
    const prev = byId.get(t.assigneeId)!;

    if (t.urgent && minsToDue <= POLICY.urgentReplaceBeforeMin) {
      t.declinedBy.push(prev.id);
      await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'auto_replaced', details: { member: prev.id, minsToDue: Math.round(minsToDue) } });
      await store.send({ at: nowIso, toId: prev.id, lang: prev.lang, kind: 'info', taskId: t.id, text: say(prev.lang, `«${t.text}» срочное, а ответа не было — передаю другому. Если уже в пути, напиши.`, `"${t.text}" is time-critical and there was no reply — handing it over. If you're already on it, say so.`) });
      await swapToNext(store, t, prev.id, nowIso, 'urgent, no confirmation');
      sent.push({ kind: 'auto_replace', toId: prev.id, text: t.text });
      continue;
    }
    if (silentMin >= POLICY.silenceTimeoutMin) {
      t.declinedBy.push(prev.id);
      await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'timeout', details: { member: prev.id, silentMin: Math.round(silentMin) } });
      await swapToNext(store, t, prev.id, nowIso, 'no reply');
      sent.push({ kind: 'timeout', toId: prev.id, text: t.text });
    }
  }

  const { messages, updates } = dueReminders(await store.tasks(), members, nowIso, store.tz);
  for (const u of updates) {
    const t = (await store.tasks()).find(x => x.id === u.taskId)!;
    t.reminderLevel = u.level;
    await store.saveTask(t);
    await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'reminded', details: { level: u.level } });
  }
  for (const m of messages) { await store.send(m); sent.push({ kind: 'reminder', toId: m.toId, text: m.text }); }
  return sent;
}

export async function weeklyReport(store: DomovoyStore, refIso: string, lang: 'ru' | 'en' = 'ru') {
  const [members, tasks] = await Promise.all([store.members(), store.tasks()]);
  const rows = weeklyLedger(members, tasks, refIso);
  return { rows, suggestion: balanceSuggestion(rows, lang) };
}
