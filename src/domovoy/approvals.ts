/**
 * Human checkpoints.
 *
 * The agent may plan and act on its own, but some actions must pass through a person:
 * moving a child's fixed activity, spending money, cancelling someone's task, sending
 * household data outside. Those become an Approval: a stored request with a reason, a set of
 * people who may decide, a deadline, and an optional fallback the agent executes on rejection
 * (so the loop closes either way).
 *
 * Low-risk actions (a weather chore inside working hours) are executed directly and *reported*
 * with an undo button — see autonomy.ts. The policy below decides which is which.
 */
import { randomUUID } from 'node:crypto';
import type { DomovoyStore } from './store';
import type { Approval, ApprovalAction, Lang, Member, Task } from './types';
import { rankCandidates } from './tools/assign';
import { assignTask, buildContext, hhmm } from './household';
import { chargeOverride } from './payments';
import { fmtWhen } from './autonomy';

export interface ApprovalRule {
  /** who decides: household admins, the task author, or either */
  who: 'admins' | 'author' | 'author_or_admins';
  ttlMin: number;
  label: { ru: string; en: string };
}

export const APPROVAL_POLICY: Record<ApprovalAction, ApprovalRule> = {
  reschedule_task:       { who: 'author_or_admins', ttlMin: 120, label: { ru: 'перенос дела', en: 'reschedule a task' } },
  create_task:           { who: 'author_or_admins', ttlMin: 180, label: { ru: 'новое дело от агента', en: 'agent-proposed task' } },
  cancel_task:           { who: 'author', ttlMin: 120, label: { ru: 'отмена дела', en: 'cancel a task' } },
  spend_money:           { who: 'admins', ttlMin: 240, label: { ru: 'трата денег', en: 'spending money' } },
  change_child_schedule: { who: 'admins', ttlMin: 90,  label: { ru: 'изменение расписания ребёнка', en: 'changing a child\'s schedule' } },
  share_outside:         { who: 'admins', ttlMin: 60,  label: { ru: 'передача данных вне семьи', en: 'sharing data outside the family' } },
};


const say = (lang: Lang, ru: string, en: string) => (lang === 'ru' ? ru : en);
const plus = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();

/** Who may decide an action, given the policy and the people involved. */
export function approversFor(action: ApprovalAction, members: Member[], authorId?: string): string[] {
  const admins = members.filter(m => m.isAdmin).map(m => m.id);
  const author = members.find(m => m.id === authorId);
  const rule = APPROVAL_POLICY[action];
  // a child or a helper never approves on their own — it goes to the adults
  const authorCanDecide = author && author.role !== 'child' && author.role !== 'helper';
  if (rule.who === 'admins') return admins;
  if (rule.who === 'author') return authorCanDecide ? [author!.id] : admins;
  return Array.from(new Set([...(authorCanDecide ? [author!.id] : []), ...admins]));
}

/** Does this task touch a child's schedule? Then only parents decide. */
export function touchesChild(task: Task, members: Member[]): boolean {
  const kid = (id?: string) => !!id && members.find(m => m.id === id)?.role === 'child';
  return kid(task.assigneeId) || kid(task.aboutMemberId);
}

export interface ApprovalRequest {
  action: ApprovalAction;
  payload: Record<string, unknown>;
  reason: { ru: string; en: string };
  fallback?: { ru: string; en: string };
  requestedBy: string;           // member id or 'agent'
  authorId?: string;             // task author, used to pick approvers
  approverIds?: string[];        // override
  taskId?: string;
  ttlMin?: number;
}

/** Create an approval and message every approver. Returns the stored approval. */
export async function requestApproval(store: DomovoyStore, req: ApprovalRequest, nowIso: string): Promise<Approval> {
  const members = await store.members();
  const approverIds = req.approverIds?.length ? req.approverIds : approversFor(req.action, members, req.authorId);
  if (!approverIds.length) throw new Error('no approver for ' + req.action);
  const a: Approval = {
    id: 'ap-' + randomUUID().slice(0, 8),
    householdId: store.householdId,
    action: req.action,
    requestedBy: req.requestedBy,
    approverIds,
    payload: { ...req.payload, ...(req.taskId ? { taskId: req.taskId } : {}) },
    reason: req.reason,
    fallback: req.fallback,
    status: 'pending',
    createdAt: nowIso,
    expiresAt: plus(nowIso, req.ttlMin ?? APPROVAL_POLICY[req.action].ttlMin),
  };
  await store.saveApproval(a);
  await store.event({ at: nowIso, taskId: req.taskId ?? a.id, actor: req.requestedBy, type: 'approval_requested', details: { approvalId: a.id, action: a.action } });
  for (const id of approverIds) {
    const m = members.find(x => x.id === id);
    if (!m) continue;
    const text = say(m.lang, `🛡️ Нужно ваше решение (${APPROVAL_POLICY[a.action].label.ru}):\n${a.reason.ru}${a.fallback ? `\n\nЕсли «нет»: ${a.fallback.ru}` : ''}`,
      `🛡️ Your decision is needed (${APPROVAL_POLICY[a.action].label.en}):\n${a.reason.en}${a.fallback ? `\n\nIf "no": ${a.fallback.en}` : ''}`);
    await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'approval', text, approvalId: a.id, taskId: req.taskId });
  }
  return a;
}

export interface Decision { approval: Approval; outcome: 'executed' | 'rejected' | 'fallback' | 'not_allowed' | 'closed'; note: { ru: string; en: string } }

/** A person pressed approve / reject. Executes the action (or the fallback) and informs people. */
export async function decideApproval(store: DomovoyStore, approvalId: string, memberId: string, decision: 'approve' | 'reject', nowIso: string): Promise<Decision> {
  const a = (await store.approvals()).find(x => x.id === approvalId);
  if (!a) throw new Error('unknown approval');
  if (!a.approverIds.includes(memberId)) return { approval: a, outcome: 'not_allowed', note: { ru: 'Это решение не за вами.', en: 'This decision is not yours to make.' } };
  if (a.status !== 'pending') return { approval: a, outcome: 'closed', note: { ru: 'Уже решено.', en: 'Already decided.' } };
  if (a.expiresAt <= nowIso) {
    a.status = 'expired'; await store.saveApproval(a);
    return { approval: a, outcome: 'closed', note: { ru: 'Срок истёк — предложение больше не актуально.', en: 'Expired — the proposal is no longer current.' } };
  }
  a.decidedAt = nowIso; a.decidedBy = memberId;
  await store.event({ at: nowIso, taskId: (a.payload.taskId as string) ?? a.id, actor: memberId, type: 'approval_decided', details: { approvalId: a.id, action: a.action, decision } });

  if (decision === 'approve') {
    a.status = 'approved';
    try {
      a.result = await executeAction(store, a.action, a.payload, nowIso, { approvalId: a.id, decidedBy: memberId });
      a.status = 'executed';
    } catch (e: any) {
      a.status = 'failed'; a.result = { error: e?.message ?? String(e) };
    }
    await store.saveApproval(a);
    await notifyRequester(store, a, nowIso, memberId);
    return { approval: a, outcome: 'executed', note: a.status === 'executed'
      ? { ru: 'Сделано.', en: 'Done.' }
      : { ru: 'Не получилось выполнить: ' + (a.result as any).error, en: 'Could not execute: ' + (a.result as any).error } };
  }

  a.status = 'rejected';
  const onReject = a.payload.onReject as { action: ApprovalAction; payload: Record<string, unknown> } | undefined;
  if (onReject) {
    try { a.result = { fallback: await executeAction(store, onReject.action, onReject.payload, nowIso, { approvalId: a.id, decidedBy: memberId }) }; }
    catch (e: any) { a.result = { fallbackError: e?.message ?? String(e) }; }
  }
  await store.saveApproval(a);
  await notifyRequester(store, a, nowIso, memberId);
  return { approval: a, outcome: onReject ? 'fallback' : 'rejected', note: onReject
    ? { ru: 'Понял, оставляю как есть. ' + (a.fallback?.ru ?? ''), en: 'Understood, leaving it as is. ' + (a.fallback?.en ?? '') }
    : { ru: 'Понял, ничего не меняю.', en: 'Understood, changing nothing.' } };
}

/** Expire stale approvals; the agent tells the requester nothing happened. */
export async function expireApprovals(store: DomovoyStore, nowIso: string): Promise<Approval[]> {
  const expired: Approval[] = [];
  for (const a of await store.approvals({ status: 'pending' })) {
    if (a.expiresAt > nowIso) continue;
    a.status = 'expired';
    await store.saveApproval(a);
    expired.push(a);
    await notifyRequester(store, a, nowIso);
  }
  return expired;
}

async function notifyRequester(store: DomovoyStore, a: Approval, nowIso: string, decidedBy?: string) {
  const members = await store.members();
  const who = decidedBy ? members.find(m => m.id === decidedBy)?.name : undefined;
  const recipients = new Set<string>();
  if (a.requestedBy !== 'agent') recipients.add(a.requestedBy);
  // the other approvers learn the outcome too, so nobody decides twice
  for (const id of a.approverIds) if (id !== decidedBy) recipients.add(id);
  for (const id of recipients) {
    const m = members.find(x => x.id === id);
    if (!m) continue;
    const text = a.status === 'executed' ? say(m.lang, `✅ ${who ?? 'Решение'}: одобрено — ${a.reason.ru.split('\n')[0]}`, `✅ ${who ?? 'Decision'}: approved — ${a.reason.en.split('\n')[0]}`)
      : a.status === 'rejected' ? say(m.lang, `↩️ ${who ?? 'Решение'}: отклонено — оставляем как есть.`, `↩️ ${who ?? 'Decision'}: rejected — leaving as is.`)
      : a.status === 'expired' ? say(m.lang, `⌛ Никто не ответил на «${APPROVAL_POLICY[a.action].label.ru}» — ничего не меняю.`, `⌛ No reply on "${APPROVAL_POLICY[a.action].label.en}" — nothing changed.`)
      : say(m.lang, `⚠️ Одобрено, но выполнить не удалось: ${(a.result as any)?.error ?? ''}`, `⚠️ Approved but could not execute: ${(a.result as any)?.error ?? ''}`);
    await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'info', text, approvalId: a.id });
  }
}

// ──────────── execution ────────────

export interface ExecContext { approvalId?: string; decidedBy?: string }

/**
 * The actions behind approvals. Also used directly by autonomy.ts for low-risk cases
 * (the agent acts first, reports with undo) — same code path, different checkpoint.
 */
export async function executeAction(store: DomovoyStore, action: ApprovalAction, payload: Record<string, unknown>, nowIso: string, ctx: ExecContext = {}): Promise<Record<string, unknown>> {
  const members = await store.members();
  const byId = (id?: string) => members.find(m => m.id === id);

  if (action === 'reschedule_task' || action === 'change_child_schedule') {
    const { taskId, newDueAt, notifyIds } = payload as { taskId: string; newDueAt: string; notifyIds?: string[] };
    const t = (await store.tasks()).find(x => x.id === taskId);
    if (!t) throw new Error('unknown task ' + taskId);
    const from = t.dueAt;
    t.rescheduledFrom = from; t.dueAt = newDueAt; t.reminderLevel = 0;
    t.agentManaged = true; t.verifyAt = plus(newDueAt, 30); t.verifyAsked = false; t.approvalId = ctx.approvalId;
    if (t.status === 'new' || t.status === 'unassigned') t.status = t.assigneeId ? 'accepted' : t.status;
    await store.saveTask(t);
    await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'rescheduled', details: { from, to: newDueAt, approvalId: ctx.approvalId, by: ctx.decidedBy } });
    const tz = store.tz;
    const targets = new Set<string>([...(t.assigneeId ? [t.assigneeId] : []), t.authorId, ...(t.aboutMemberId ? [t.aboutMemberId] : []), ...(notifyIds ?? [])]);
    for (const id of targets) {
      const m = byId(id); if (!m) continue;
      await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'info', taskId: t.id,
        text: say(m.lang, `📅 «${t.text}» перенесено${from ? ' с ' + fmtWhen(from, tz, nowIso, 'ru') : ''} на ${fmtWhen(newDueAt, tz, nowIso, 'ru')}. Я проверю, что всё прошло, и отчитаюсь.`,
          `📅 "${t.text}" moved${from ? ' from ' + fmtWhen(from, tz, nowIso, 'en') : ''} to ${fmtWhen(newDueAt, tz, nowIso, 'en')}. I will check it happened and report back.`) });
    }
    return { taskId: t.id, from, to: newDueAt };
  }

  if (action === 'create_task') {
    const p = payload as { task: Partial<Task> & { text: string; minutes: number }; assigneeId?: string; message?: string; origin?: Task['origin']; decision?: Task['decision']; authorId?: string };
    const authorId = p.authorId ?? members.find(m => m.isAdmin)?.id ?? members[0].id;
    const t: Task = {
      id: 't-' + randomUUID().slice(0, 8), authorId, text: p.task.text, dueAt: p.task.dueAt, place: p.task.place,
      minutes: p.task.minutes, skills: p.task.skills ?? [], kidSafe: !!p.task.kidSafe, urgent: p.task.urgent,
      candidateIds: [], declinedBy: [], status: 'new', reminderLevel: 0, createdAt: nowIso,
      origin: p.origin ?? 'approval', agentManaged: true, approvalId: ctx.approvalId, decision: p.decision,
      verifyAt: plus(p.task.dueAt ?? nowIso, p.task.dueAt ? 30 : 120),
    };
    const ctxA = await buildContext(store, nowIso);
    ctxA.existingTasks = await store.tasks();
    const { allowed } = rankCandidates(members, t, ctxA);
    t.candidateIds = allowed.map(c => c.memberId);
    await store.saveTask(t);
    await store.event({ at: nowIso, taskId: t.id, actor: 'agent', type: 'created', details: { text: t.text, origin: t.origin, approvalId: ctx.approvalId } });
    const pick = p.assigneeId && t.candidateIds.includes(p.assigneeId) ? p.assigneeId : t.candidateIds[0];
    if (!pick) { t.status = 'unassigned'; await store.saveTask(t); return { taskId: t.id, assigned: false }; }
    const reason = allowed.find(c => c.memberId === pick)?.reasons.join(', ') ?? 'agent proposal';
    await assignTask(store, t, pick, reason, nowIso, p.message);
    return { taskId: t.id, assigned: true, assigneeId: pick };
  }

  if (action === 'cancel_task') {
    const { taskId, why } = payload as { taskId: string; why?: string };
    const t = (await store.tasks()).find(x => x.id === taskId);
    if (!t) throw new Error('unknown task ' + taskId);
    t.status = 'cancelled';
    await store.saveTask(t);
    await store.event({ at: nowIso, taskId: t.id, actor: ctx.decidedBy ?? 'agent', type: 'blocked', details: { reason: why ?? 'cancelled', approvalId: ctx.approvalId } });
    for (const id of new Set([t.assigneeId, t.authorId].filter(Boolean) as string[])) {
      const m = byId(id); if (!m) continue;
      await store.send({ at: nowIso, toId: m.id, lang: m.lang, kind: 'info', taskId: t.id, text: say(m.lang, `❌ Отменено: «${t.text}».`, `❌ Cancelled: "${t.text}".`) });
    }
    return { taskId: t.id, cancelled: true };
  }

  if (action === 'spend_money') {
    const { amount, currency, purpose, taskId, paymentId } = payload as { amount: number; currency: string; purpose: string; taskId?: string; paymentId?: string };
    if (paymentId && ctx.decidedBy) {
      const r = await chargeOverride(store, paymentId, ctx.decidedBy, nowIso);
      return { paymentId, outcome: r.outcome, providerRef: r.payment.providerRef };
    }
    await store.event({ at: nowIso, taskId: taskId ?? 'budget', actor: ctx.decidedBy ?? 'agent', type: 'info', details: { kind: 'spend_approved', amount, currency, purpose, approvalId: ctx.approvalId } });
    return { approvedAmount: amount, currency, purpose };
  }

  if (action === 'share_outside') {
    const { what, to } = payload as { what: string; to: string };
    await store.event({ at: nowIso, taskId: 'privacy', actor: ctx.decidedBy ?? 'agent', type: 'info', details: { kind: 'share_approved', what, to, approvalId: ctx.approvalId } });
    return { shared: what, to };
  }

  throw new Error('unknown action ' + action);
}
