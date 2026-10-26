/**
 * Impact metrics — the numbers the family (and a jury) can check.
 *
 * Everything is computed from the event log and the tasks, nothing is stored separately, so the
 * figures cannot drift from what actually happened. Time-saved is an *estimate* with the
 * assumptions printed next to it; every other number is a count.
 */
import type { DomovoyStore } from './store';
import type { AutonomyLevel, Lang, Task } from './types';
import { learningReport } from './learning';
import { monthSpent } from './payments';

/** Minutes of coordination a human organiser would otherwise spend. Stated openly, easy to argue with. */
export const SAVINGS_ASSUMPTIONS = {
  perDispatchedTask: 4,     // writing to the person, waiting, re-asking
  perReminder: 2,           // one nudge the organiser did not have to send
  perSwap: 6,               // finding someone else after a decline / silence
  perAutonomousAction: 6,   // the agent noticed and acted; nobody had to think of it
  perConflictPrevented: 20, // a rained-out plan rescheduled before it failed
};

export interface MemberImpact { id: string; name: string; role: string; done: number; minutes: number; withoutReminder: number; autonomy: AutonomyLevel | null }

export interface ImpactMetrics {
  periodDays: number;
  from: string; to: string;
  tasksCreated: number;
  tasksDone: number;
  doneWithoutReminder: number;          // closed before the first nudge
  doneWithoutReminderPct: number;       // 0..100
  remindersSent: number;
  swaps: number;                        // decline / timeout / urgent → handed over automatically
  autonomousActions: number;            // the agent acted without being asked (weather chores, predictions)
  approvalsRequested: number;
  approvalsApproved: number;
  approvalsRejected: number;
  approvalRatePct: number;              // approved / decided
  conflictsPrevented: number;           // weather-vs-plan reschedules that went through
  loopsClosed: number;                  // agent-managed tasks confirmed done
  verificationsAsked: number;
  avgResponseMin: number | null;        // assignment → accept/decline
  minutesCoordinated: number;           // sum of done task minutes
  estimatedMinutesSaved: number;
  perMember: MemberImpact[];
  learning: { patterns: number; choresAct: number; choresAsk: number; choresRemind: number };
  payments: { paid: number; refunded: number; stoppedByRules: number; cardDeclined: number; spent: number; monthSpent: number; currency: string };
  assumptions: typeof SAVINGS_ASSUMPTIONS;
}

const t2 = (x: string) => new Date(x).getTime();

export async function impactMetrics(store: DomovoyStore, nowIso: string, periodDays = 7): Promise<ImpactMetrics> {
  const [tasks, events, members, approvals, lr, pays, wallet] = await Promise.all([store.tasks(), store.events(), store.members(), store.approvals(), learningReport(store, 'en'), store.payments(), store.wallet()]);
  const paysIn = pays.filter(p => p.createdAt >= new Date(t2(nowIso) - periodDays * 86_400_000).toISOString() && p.createdAt <= nowIso);
  const from = new Date(t2(nowIso) - periodDays * 86_400_000).toISOString();
  const inPeriod = (iso?: string) => !!iso && iso >= from && iso <= nowIso;
  const ev = events.filter(e => inPeriod(e.at));

  const created = tasks.filter(t => inPeriod(t.createdAt));
  const done = tasks.filter(t => t.status === 'done' && inPeriod(t.doneAt));
  const remindedIds = new Set(ev.filter(e => e.type === 'reminded').map(e => e.taskId));
  const withoutReminder = done.filter(t => !remindedIds.has(t.id) && t.reminderLevel === 0);
  const reminders = ev.filter(e => e.type === 'reminded').length;
  const swaps = ev.filter(e => e.type === 'swapped' || e.type === 'auto_replaced').length;
  const autonomous = ev.filter(e => e.type === 'autonomous_action').length;
  const aps = approvals.filter(a => inPeriod(a.createdAt));
  const approved = aps.filter(a => a.status === 'executed' || a.status === 'approved').length;
  const rejected = aps.filter(a => a.status === 'rejected').length;
  const conflicts = aps.filter(a => (a.action === 'reschedule_task' || a.action === 'change_child_schedule') && a.status === 'executed').length;
  const loops = ev.filter(e => e.type === 'loop_closed').length;
  const verifications = ev.filter(e => e.type === 'verification_asked').length;

  // response time: assigned → accepted/declined by the same person
  const speeds: number[] = [];
  for (const a of ev.filter(e => e.type === 'assigned')) {
    const r = ev.find(e => e.taskId === a.taskId && (e.type === 'accepted' || e.type === 'declined') && e.at > a.at && e.actor === (a.details?.to as string));
    if (r) speeds.push((t2(r.at) - t2(a.at)) / 60_000);
  }
  const avgResponse = speeds.length ? Math.round(speeds.reduce((s, x) => s + x, 0) / speeds.length) : null;

  const minutesCoordinated = done.reduce((s, t) => s + t.minutes, 0);
  const A = SAVINGS_ASSUMPTIONS;
  const saved = created.length * A.perDispatchedTask + reminders * A.perReminder + swaps * A.perSwap + autonomous * A.perAutonomousAction + conflicts * A.perConflictPrevented;

  const perMember: MemberImpact[] = members.map(m => {
    const mine = done.filter(t => t.assigneeId === m.id);
    const levels = lr.rows.filter(r => r.executorId === m.id).map(r => r.level);
    const autonomy: AutonomyLevel | null = levels.includes('act') ? 'act' : levels.includes('ask') ? 'ask' : levels.length ? 'remind' : null;
    return { id: m.id, name: m.name, role: m.role, done: mine.length, minutes: mine.reduce((s, t) => s + t.minutes, 0), withoutReminder: mine.filter(t => withoutReminder.includes(t)).length, autonomy };
  });

  return {
    periodDays, from, to: nowIso,
    tasksCreated: created.length, tasksDone: done.length,
    doneWithoutReminder: withoutReminder.length,
    doneWithoutReminderPct: done.length ? Math.round(100 * withoutReminder.length / done.length) : 0,
    remindersSent: reminders, swaps, autonomousActions: autonomous,
    approvalsRequested: aps.length, approvalsApproved: approved, approvalsRejected: rejected,
    approvalRatePct: approved + rejected ? Math.round(100 * approved / (approved + rejected)) : 0,
    conflictsPrevented: conflicts, loopsClosed: loops, verificationsAsked: verifications,
    avgResponseMin: avgResponse, minutesCoordinated, estimatedMinutesSaved: saved,
    perMember,
    learning: { patterns: lr.patterns, choresAct: lr.rows.filter(r => r.level === 'act').length, choresAsk: lr.rows.filter(r => r.level === 'ask').length, choresRemind: lr.rows.filter(r => r.level === 'remind').length },
    payments: {
      paid: paysIn.filter(p => p.status === 'paid').length, refunded: paysIn.filter(p => p.status === 'refunded').length,
      stoppedByRules: paysIn.filter(p => (p.status === 'declined' || p.status === 'pending_approval') && p.rule).length,
      cardDeclined: paysIn.filter(p => p.status === 'failed').length,
      spent: paysIn.filter(p => p.status === 'paid').reduce((s, p) => s + p.amountInWallet, 0), monthSpent: monthSpent(pays, nowIso), currency: wallet.currency,
    },
    assumptions: A,
  };
}

export function formatImpact(m: ImpactMetrics, lang: Lang): string {
  const h = Math.floor(m.estimatedMinutesSaved / 60), mm = m.estimatedMinutesSaved % 60;
  if (lang === 'ru') {
    return [
      `📊 Итоги за ${m.periodDays} дн.`,
      `• Дел создано ${m.tasksCreated}, выполнено ${m.tasksDone} (${m.minutesCoordinated} мин домашней работы)`,
      `• Без единого напоминания: ${m.doneWithoutReminder} из ${m.tasksDone} (${m.doneWithoutReminderPct}%)`,
      `• Агент сам: ${m.autonomousActions} действий, ${m.swaps} передач после отказа/молчания, ${m.remindersSent} напоминаний`,
      `• Чекпоинты: ${m.approvalsRequested} запросов, одобрено ${m.approvalsApproved}, отклонено ${m.approvalsRejected} (${m.approvalRatePct}% доверия)`,
      `• Конфликтов с погодой предотвращено: ${m.conflictsPrevented} · циклов закрыто с проверкой: ${m.loopsClosed}`,
      m.avgResponseMin !== null ? `• Среднее время ответа семьи: ${m.avgResponseMin} мин` : '',
      `• Выучено закономерностей: ${m.learning.patterns} · дел «делаю сам»: ${m.learning.choresAct}, «предлагаю»: ${m.learning.choresAsk}`,
      `• Платежи: оплачено ${m.payments.paid} на ${m.payments.spent} ${m.payments.currency}, остановлено правилами ${m.payments.stoppedByRules}, возвратов ${m.payments.refunded}`,
      `⏱ Организатору сэкономлено ≈ ${h ? h + ' ч ' : ''}${mm} мин (оценка: ${m.assumptions.perDispatchedTask} мин/дело, ${m.assumptions.perSwap} мин/передача, ${m.assumptions.perConflictPrevented} мин/конфликт)`,
    ].filter(Boolean).join('\n');
  }
  return [
    `📊 Last ${m.periodDays} days`,
    `• Tasks created ${m.tasksCreated}, done ${m.tasksDone} (${m.minutesCoordinated} min of housework)`,
    `• Done without a single reminder: ${m.doneWithoutReminder} of ${m.tasksDone} (${m.doneWithoutReminderPct}%)`,
    `• Agent on its own: ${m.autonomousActions} actions, ${m.swaps} hand-overs after decline/silence, ${m.remindersSent} reminders`,
    `• Checkpoints: ${m.approvalsRequested} requested, ${m.approvalsApproved} approved, ${m.approvalsRejected} rejected (${m.approvalRatePct}% trust)`,
    `• Weather conflicts prevented: ${m.conflictsPrevented} · loops closed with verification: ${m.loopsClosed}`,
    m.avgResponseMin !== null ? `• Family's average reply time: ${m.avgResponseMin} min` : '',
    `• Patterns learned: ${m.learning.patterns} · chores "I handle": ${m.learning.choresAct}, "I propose": ${m.learning.choresAsk}`,
    `• Payments: ${m.payments.paid} paid for ${m.payments.spent} ${m.payments.currency}, ${m.payments.stoppedByRules} stopped by the rules, ${m.payments.refunded} refunded`,
    `⏱ Organiser time saved ≈ ${h ? h + ' h ' : ''}${mm} min (estimate: ${m.assumptions.perDispatchedTask} min/task, ${m.assumptions.perSwap} min/hand-over, ${m.assumptions.perConflictPrevented} min/conflict)`,
  ].filter(Boolean).join('\n');
}

/** Tasks the agent touched on its own — for the panel timeline. */
export function agentActions(tasks: Task[]): Task[] {
  return tasks.filter(t => t.agentManaged || t.origin === 'weather' || t.origin === 'prediction').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
