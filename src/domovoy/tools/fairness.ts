import type { Member, Task } from '../types';

export interface FairnessRow { memberId: string; name: string; role: string; minutes: number; tasks: number; points: number }

/** Anti-farming: tasks shorter than this earn no points. / Антифарминг: задачи короче этого не дают очков. */
export const MIN_MINUTES_FOR_POINTS = 5;
/** Anti-farming: max points a child can earn per calendar day. / Максимум очков ребёнка в день. */
export const DAILY_POINTS_CAP = 50;

/** Minutes of done tasks per member in the ISO week containing `ref`. */
export function weeklyLedger(members: Member[], tasks: Task[], refIso: string): FairnessRow[] {
  const { start, end } = weekBounds(refIso);
  return members.map(m => {
    const done = tasks.filter(t => t.assigneeId === m.id && t.status === 'done' && t.doneAt && t.doneAt >= start && t.doneAt < end);
    const minutes = done.reduce((s, t) => s + t.minutes, 0);
    let points = 0;
    if (m.role === 'child') {
      // Group qualifying tasks by day, cap each day at DAILY_POINTS_CAP
      const byDay: Record<string, number> = {};
      for (const t of done) {
        if (t.minutes < MIN_MINUTES_FOR_POINTS) continue; // anti-farming: skip trivial tasks
        const day = (t.doneAt ?? t.createdAt).slice(0, 10);
        byDay[day] = Math.min((byDay[day] ?? 0) + 10, DAILY_POINTS_CAP);
      }
      points = Object.values(byDay).reduce((s, v) => s + v, 0);
    }
    return { memberId: m.id, name: m.name, role: m.role, minutes, tasks: done.length, points };
  });
}

/** Helper minutes are paid work; the balance that matters is between adults. */
export function balanceSuggestion(rows: FairnessRow[], lang: 'ru' | 'en' = 'ru'): string {
  const adults = rows.filter(r => r.role === 'adult').sort((a, b) => b.minutes - a.minutes);
  if (adults.length < 2) return '';
  const [hi, lo] = adults;
  const gap = hi.minutes - lo.minutes;
  if (gap < 45) return lang === 'ru' ? 'Нагрузка между взрослыми ровная. Так держать.' : 'Load between adults is even. Keep it up.';
  return lang === 'ru'
    ? `${hi.name} сделал(а) на ${gap} мин больше, чем ${lo.name}. На следующей неделе Домовёнок будет чаще предлагать дела ${lo.name}.`
    : `${hi.name} did ${gap} min more than ${lo.name}. Next week Domovoy will offer more tasks to ${lo.name}.`;
}

export function weekBounds(refIso: string) {
  const d = new Date(refIso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}
