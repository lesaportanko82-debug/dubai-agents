/**
 * Code-only household operations: accept / decline / swap / done / reminder tick / weekly report.
 * No model involved — these must be predictable.
 */
import type { DomovoyStore } from './store';
import type { Insight, Lang, Member, Task } from './types';
import { rankCandidates, type AssignContext } from './tools/assign';
import { dueReminders } from './tools/reminders';
import { balanceSuggestion, weeklyLedger, weekBounds } from './tools/fairness';
import { detectPatterns } from './memory';
import { getWeather, analyzeWeatherAlerts, type WeatherAlert } from './integrations';

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
  // Self-task: auto-accept (no confirmation needed when author assigns to themselves)
  task.status = task.authorId === memberId ? 'accepted' : 'assigned';
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

  // P2.4 Goal difficulty auto-adjustment: if progress/threshold < 0.5 with ≤2 days to deadline → suggest lowering
  const goals = await store.goals();
  const TWO_DAYS_MS = 2 * 86_400_000;
  for (const g of goals) {
    if (g.status !== 'active' || g.type !== 'deadline') continue;
    const deadlineMs = new Date(g.updatedAt).getTime() + g.threshold * 86_400_000; // threshold = days for deadline goals
    const remaining = deadlineMs - now;
    if (remaining > TWO_DAYS_MS || remaining <= 0) continue;
    if (g.threshold === 0 || g.progress / g.threshold >= 0.5) continue;
    // Already warned? Check events for this goal
    const warned = (await store.events()).some(e => e.type === 'info' as string && e.details?.goalId === g.id && e.details?.kind === 'difficulty_warning');
    if (warned) continue;
    const admins = members.filter(m => m.isAdmin);
    const target = byId.get(g.targetMemberId);
    for (const admin of admins) {
      await store.send({ at: nowIso, toId: admin.id, lang: admin.lang, kind: 'info',
        text: say(admin.lang,
          `⚠️ Цель «${g.title}» для ${target?.name ?? '?'}: прогресс ${g.progress}/${g.threshold} — может быть слишком сложно. Снизить порог или продлить?`,
          `⚠️ Goal "${g.title}" for ${target?.name ?? '?'}: progress ${g.progress}/${g.threshold} — may be too hard. Lower the target or extend?`) });
      sent.push({ kind: 'goal_warning', toId: admin.id, text: g.title });
    }
    await store.event({ at: nowIso, taskId: g.id, actor: 'agent', type: 'info' as any, details: { goalId: g.id, kind: 'difficulty_warning' } });
  }

  // ── Pillar 3: Deliver pending reminders ──
  const dueRems = await store.reminders({ pending: true });
  for (const rem of dueRems) {
    if (rem.remindAt > nowIso) continue;
    const m = byId.get(rem.memberId);
    if (!m) continue;
    await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'reminder', text: `🔔 ${rem.text}` });
    sent.push({ kind: 'scheduled_reminder', toId: m.id, text: rem.text });
    if (rem.recurring) {
      // Schedule the next occurrence
      const next = new Date(rem.remindAt);
      if (rem.recurring === 'daily') next.setDate(next.getDate() + 1);
      else if (rem.recurring === 'weekly') next.setDate(next.getDate() + 7);
      else if (rem.recurring === 'monthly') next.setMonth(next.getMonth() + 1);
      rem.remindAt = next.toISOString();
      await store.saveReminder(rem);
    } else {
      rem.status = 'sent';
      await store.saveReminder(rem);
    }
  }

  // ── Pillar 1: Run pattern detection (once per hour max) ──
  const lastPatternRun = (await store.events()).filter(e => e.type === 'info' as any && e.details?.kind === 'pattern_detection').pop();
  const hoursSincePatterns = lastPatternRun ? (now - t2(lastPatternRun.at)) / 3_600_000 : Infinity;
  if (hoursSincePatterns >= 1) {
    await detectPatterns(store, nowIso);
    await store.event({ at: nowIso, taskId: 'system', actor: 'agent', type: 'info' as any, details: { kind: 'pattern_detection' } });
  }

  // ── Proactive weather check (once per hour) ──
  const lastWeatherRun = (await store.events()).filter(e => e.type === 'info' as any && e.details?.kind === 'weather_check').pop();
  const hoursSinceWeather = lastWeatherRun ? (now - t2(lastWeatherRun.at)) / 3_600_000 : Infinity;
  if (hoursSinceWeather >= 1) {
    try {
      const weather = await getWeather({ city: 'Dubai' });
      const alerts = analyzeWeatherAlerts(weather);
      if (alerts.length > 0) {
        // Create weather_alert insights for admins
        const recentInsights = await store.insights({ limit: 20 });
        const lastHourAlerts = recentInsights.filter(i => i.insightType === 'weather_alert' && t2(i.createdAt) > now - 3_600_000);
        if (lastHourAlerts.length === 0) {
          const taskSuggestions = alerts.map((a: WeatherAlert) => a.taskSuggestion.en);
          for (const m of members.filter(m => m.isAdmin)) {
            const ins: Insight = {
              householdId: store.householdId, insightType: 'weather_alert',
              targetMemberId: m.id, delivered: false, createdAt: nowIso,
              data: { alerts: alerts.map((a: WeatherAlert) => a.type), conditions: weather.description, temp: weather.temp, suggestedTasks: taskSuggestions },
            };
            await store.saveInsight(ins);
            const text = formatInsight(ins, m.lang);
            if (text) {
              await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'info', text });
              sent.push({ kind: 'insight_weather_alert', toId: m.id, text });
            }
          }
        }
      }
      await store.event({ at: nowIso, taskId: 'system', actor: 'agent', type: 'info' as any, details: { kind: 'weather_check' } });
    } catch (err) {
      console.error('Weather check failed:', err);
    }
  }

  // ── Pillar 4: Generate proactive insights ──
  const insights = await generateInsights(store, members, tasks, nowIso);
  for (const ins of insights) {
    await store.saveInsight(ins);
    // Deliver insight messages
    const target = ins.targetMemberId ? byId.get(ins.targetMemberId) : undefined;
    const admins = members.filter(m => m.isAdmin);
    const recipients = target ? [target] : admins;
    for (const r of recipients) {
      const text = formatInsight(ins, r.lang);
      if (text) {
        await store.send({ at: nowIso, toId: r.id, lang: r.lang, kind: 'info', text });
        sent.push({ kind: `insight_${ins.insightType}`, toId: r.id, text });
      }
    }
    await store.markInsightDelivered(ins.id!);
  }

  return sent;
}

/** Generate proactive insights based on current household state */
async function generateInsights(store: DomovoyStore, members: Member[], tasks: Task[], nowIso: string): Promise<Insight[]> {
  const now = new Date(nowIso);
  const hour = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: store.tz, hour: '2-digit', hour12: false }).format(now));
  const insights: Insight[] = [];
  const recentInsights = await store.insights({ limit: 50 });
  const todayStr = nowIso.slice(0, 10);
  const alreadyToday = (type: string) => recentInsights.some(i => i.insightType === type && i.createdAt.slice(0, 10) === todayStr);

  // ── Morning briefing (once per day, 7-9 AM) ──
  if (hour >= 7 && hour <= 9 && !alreadyToday('morning_briefing')) {
    const openTasks = tasks.filter(t => ['assigned', 'accepted', 'new'].includes(t.status));
    const todayDue = openTasks.filter(t => t.dueAt?.slice(0, 10) === todayStr);
    if (openTasks.length > 0) {
      for (const m of members.filter(m => m.isAdmin)) {
        insights.push({
          householdId: store.householdId, insightType: 'morning_briefing',
          targetMemberId: m.id, delivered: false, createdAt: nowIso,
          data: { openCount: openTasks.length, todayDueCount: todayDue.length, todayDueTasks: todayDue.slice(0, 5).map(t => t.text) },
        });
      }
    }
  }

  // ── Overload warning — member > 80% daily limit ──
  if (!alreadyToday('overload_warning')) {
    const day = nowIso.slice(0, 10);
    for (const m of members) {
      const todayOpen = tasks.filter(t => t.assigneeId === m.id && ['assigned', 'accepted'].includes(t.status) && (t.dueAt ?? t.createdAt).slice(0, 10) === day).length;
      if (todayOpen >= m.dailyLimit * 0.8 && todayOpen > 1) {
        insights.push({
          householdId: store.householdId, insightType: 'overload_warning',
          targetMemberId: m.id, delivered: false, createdAt: nowIso,
          data: { memberName: m.name, openCount: todayOpen, limit: m.dailyLimit },
        });
      }
    }
  }

  // ── Rebalance suggestion (once per day, afternoon) ──
  if (hour >= 14 && hour <= 16 && !alreadyToday('rebalance_suggestion')) {
    const { start, end } = weekBounds(nowIso);
    const weekMinutes: Record<string, number> = {};
    for (const m of members) {
      weekMinutes[m.id] = tasks.filter(t => t.assigneeId === m.id && t.status === 'done' && t.doneAt && t.doneAt >= start && t.doneAt < end).reduce((s, t) => s + t.minutes, 0);
    }
    const vals = Object.values(weekMinutes).filter(v => v > 0);
    if (vals.length >= 2) {
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      if (max > 0 && max / Math.max(min, 1) > 2) {
        const overloaded = members.find(m => weekMinutes[m.id] === max);
        const underloaded = members.find(m => weekMinutes[m.id] === min);
        insights.push({
          householdId: store.householdId, insightType: 'rebalance_suggestion',
          delivered: false, createdAt: nowIso,
          data: { overloaded: overloaded?.name, overMin: max, underloaded: underloaded?.name, underMin: min },
        });
      }
    }
  }

  // ── Conflict warning from patterns ──
  if (!alreadyToday('conflict_warning')) {
    const patterns = await store.patterns();
    const conflicts = patterns.filter(p => p.patternType === 'pair_conflict' && p.active && p.confidence >= 0.5);
    for (const c of conflicts) {
      // Only warn once per pair per week
      const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const alreadyWarned = recentInsights.some(i => i.insightType === 'conflict_warning' && i.createdAt >= weekAgo && (i.data as any).partnerId === c.data.partnerId && i.targetMemberId === c.memberId);
      if (!alreadyWarned) {
        insights.push({
          householdId: store.householdId, insightType: 'conflict_warning',
          targetMemberId: c.memberId, delivered: false, createdAt: nowIso,
          data: { partnerId: c.data.partnerId, partnerName: c.data.partnerName, declineCount: c.data.declineCount },
        });
      }
    }
  }

  // ── Streak alert (quest mode: celebrate streaks) ──
  if (!alreadyToday('streak_alert')) {
    if (store.mode === 'quest') {
      for (const m of members.filter(m => m.role === 'child')) {
        const doneLast7 = tasks.filter(t => t.assigneeId === m.id && t.status === 'done' && t.doneAt && t2(t.doneAt) > now.getTime() - 7 * 86_400_000);
        const daysWithDone = new Set(doneLast7.map(t => t.doneAt!.slice(0, 10)));
        if (daysWithDone.size >= 5) {
          insights.push({
            householdId: store.householdId, insightType: 'streak_alert',
            targetMemberId: m.id, delivered: false, createdAt: nowIso,
            data: { streakDays: daysWithDone.size, memberName: m.name },
          });
        }
      }
    }
  }

  return insights;
}

/** Format an insight into a human-readable message */
function formatInsight(ins: Insight, lang: Lang): string | undefined {
  const d = ins.data as Record<string, any>;
  switch (ins.insightType) {
    case 'morning_briefing':
      return lang === 'ru'
        ? `☀️ Доброе утро! Сегодня ${d.todayDueCount} дел на сегодня, всего открыто: ${d.openCount}.${d.todayDueTasks?.length ? ' Главные: ' + d.todayDueTasks.join(', ') : ''}`
        : `☀️ Good morning! ${d.todayDueCount} tasks due today, ${d.openCount} open total.${d.todayDueTasks?.length ? ' Top: ' + d.todayDueTasks.join(', ') : ''}`;
    case 'overload_warning':
      return lang === 'ru'
        ? `⚠️ ${d.memberName} сегодня ${d.openCount}/${d.limit} дел — рядом с лимитом.`
        : `⚠️ ${d.memberName} has ${d.openCount}/${d.limit} tasks today — near limit.`;
    case 'rebalance_suggestion':
      return lang === 'ru'
        ? `⚖️ На этой неделе дисбаланс: ${d.overloaded} — ${d.overMin} мин, ${d.underloaded} — ${d.underMin} мин. Перераспределить?`
        : `⚖️ Week imbalance: ${d.overloaded} — ${d.overMin}min, ${d.underloaded} — ${d.underMin}min. Rebalance?`;
    case 'conflict_warning':
      return lang === 'ru'
        ? `🔥 Напряжение между участниками: ${d.declineCount} взаимных отказов с ${d.partnerName}. Стоит обсудить.`
        : `🔥 Friction detected: ${d.declineCount} mutual declines with ${d.partnerName}. Worth discussing.`;
    case 'streak_alert':
      return lang === 'ru'
        ? `🔥 ${d.memberName} — ${d.streakDays} дней подряд с выполненными заданиями! Отличная серия!`
        : `🔥 ${d.memberName} — ${d.streakDays}-day streak of completed tasks! Amazing!`;
    case 'weather_alert': {
      const alertTypes = (d.alerts as string[]) ?? [];
      const taskList = (d.suggestedTasks as string[]) ?? [];
      const alertEmojis: Record<string, string> = { rain_coming: '🌧️', storm: '⛈️', extreme_heat: '🔥', cold_snap: '🥶' };
      const emoji = alertEmojis[alertTypes[0]] ?? '🌤️';
      const tasksStr = taskList.length > 0 ? (lang === 'ru' ? ` Советую: ${taskList.join(', ')}` : ` Suggested: ${taskList.join(', ')}`) : '';
      return lang === 'ru'
        ? `${emoji} Погода: ${d.conditions}, ${d.temp}°C.${tasksStr}`
        : `${emoji} Weather: ${d.conditions}, ${d.temp}°C.${tasksStr}`;
    }
    default:
      return undefined;
  }
}

export async function weeklyReport(store: DomovoyStore, refIso: string, lang: 'ru' | 'en' = 'ru') {
  const [members, tasks] = await Promise.all([store.members(), store.tasks()]);
  const rows = weeklyLedger(members, tasks, refIso);
  return { rows, suggestion: balanceSuggestion(rows, lang) };
}
