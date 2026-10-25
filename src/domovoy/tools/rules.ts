import { KID_SKILLS } from '../fixtures';
import type { Member, Task } from '../types';

export interface RuleResult { ok: boolean; reason?: string }

const hm = (iso: string, tz: string) => {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday'));
  return { time: `${get('hour')}:${get('minute')}`, weekday: wd };
};

/**
 * Hard rules the agent cannot override. Evaluated at the task's due time (or now).
 */
export function canAssign(m: Member, t: Task, opts: { now: string; tz?: string; openTasksToday: number }): RuleResult {
  const tz = opts.tz ?? 'Asia/Dubai';
  const when = t.dueAt ?? opts.now;

  if (m.id === t.authorId && m.role === 'adult') {
    // the author may do it, but the dispatcher prefers others; not a hard block
  }
  if (t.declinedBy.includes(m.id)) return { ok: false, reason: 'already declined' };

  if (m.role === 'child') {
    if (!t.kidSafe) return { ok: false, reason: 'not a task for a child' };
    const age = m.age ?? 0;
    const ageOk = t.skills.filter(s => m.skills.includes(s)).some(s => age >= (KID_SKILLS[s] ?? 99));
    if (t.skills.length && !ageOk) return { ok: false, reason: `too young for ${t.skills.join('/')}` };
    if (t.minutes > 30) return { ok: false, reason: 'too long for a child' };
  }

  if (m.role === 'helper') {
    const { time, weekday } = hm(when, tz);
    if (m.dayOff?.includes(weekday)) return { ok: false, reason: 'helper day off' };
    if (m.workHours && (time < m.workHours.from || time > m.workHours.to)) return { ok: false, reason: 'outside helper working hours' };
  }

  // skills on a task are alternative ways to do it (drive OR walk); a member needs at least one
  if (t.skills.length && !t.skills.some(s => m.skills.includes(s))) return { ok: false, reason: 'missing skill' };

  if (opts.openTasksToday >= m.dailyLimit) return { ok: false, reason: 'daily limit reached' };

  if (t.dueAt) {
    const due = new Date(t.dueAt).getTime();
    const clash = m.busy.find(b => due >= new Date(b.from).getTime() && due <= new Date(b.to).getTime());
    if (clash) return { ok: false, reason: `busy: ${clash.what ?? 'calendar'}` };
  }
  return { ok: true };
}
