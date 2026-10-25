import type { Candidate, Member, Task } from '../types';
import { canAssign } from './rules';

export interface AssignContext {
  now: string;
  tz?: string;
  /** minutes of chores done this week per member (fairness ledger) */
  weekMinutes: Record<string, number>;
  /** open (assigned/accepted) tasks today per member */
  openToday: Record<string, number>;
}

/**
 * Deterministic ranking. Returns ALLOWED candidates only, best first, with reasons.
 * The model may choose among them and explain; it cannot add anyone else.
 */
export function rankCandidates(members: Member[], task: Task, ctx: AssignContext): { allowed: Candidate[]; blocked: { memberId: string; reason: string }[] } {
  const allowed: Candidate[] = [];
  const blocked: { memberId: string; reason: string }[] = [];
  const adultsAvg = avg(members.filter(m => m.role === 'adult').map(m => ctx.weekMinutes[m.id] ?? 0));

  for (const m of members) {
    const r = canAssign(m, task, { now: ctx.now, tz: ctx.tz, openTasksToday: ctx.openToday[m.id] ?? 0 });
    if (!r.ok) { blocked.push({ memberId: m.id, reason: r.reason! }); continue; }

    let score = 50;
    const reasons: string[] = [];

    // fairness: fewer minutes this week → higher score
    const mins = ctx.weekMinutes[m.id] ?? 0;
    const fair = Math.max(-20, Math.min(20, (adultsAvg - mins) / 6));
    score += fair;
    if (fair > 5) reasons.push('did less this week');
    if (fair < -5) reasons.push('already did a lot this week');

    // load today
    const open = ctx.openToday[m.id] ?? 0;
    score -= open * 6;
    if (open === 0) reasons.push('free today');

    // the author should not be the dispatcher's first choice
    if (m.id === task.authorId) { score -= 25; reasons.push('author of the task'); }

    // kids get kid tasks (learning + points), elders get light tasks
    if (m.role === 'child' && task.kidSafe) { score += 10; reasons.push('good chore for a child'); }
    if (m.role === 'elder' && task.minutes > 40) { score -= 15; reasons.push('long task for an elder'); }

    // helpers: prefer for household chores within hours, not for family-only errands
    if (m.role === 'helper') {
      if (task.skills.some(s => ['shop', 'tidy', 'laundry', 'cook', 'water_plants'].includes(s))) { score += 8; reasons.push('household chore within working hours'); }
      if (task.skills.includes('pickup_walk')) { score -= 5; reasons.push('family errand, helper as backup'); }
    }

    allowed.push({ memberId: m.id, score: Math.round(score), reasons });
  }
  allowed.sort((a, b) => b.score - a.score);
  return { allowed, blocked };
}

function avg(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
