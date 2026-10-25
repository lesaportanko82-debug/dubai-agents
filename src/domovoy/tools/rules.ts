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
export function canAssign(m: Member, t: Task, opts: { now: string; tz?: string; openTasksToday: number; existingTasks?: Task[] }): RuleResult {
  const tz = opts.tz ?? 'Asia/Dubai';
  const when = t.dueAt ?? opts.now;

  if (m.id === t.authorId && m.role === 'adult') {
    // the author may do it, but the dispatcher prefers others; not a hard block
  }
  if (t.declinedBy.includes(m.id)) return { ok: false, reason: 'already declined' };
  if (t.aboutMemberId && t.aboutMemberId === m.id) return { ok: false, reason: 'the task is about this person' };

  if (m.role === 'child') {
    if (!t.kidSafe) return { ok: false, reason: 'not a task for a child' };
    const age = m.age ?? 0;
    const common = t.skills.filter(s => m.skills.includes(s));
    if (common.length && !common.some(s => age >= (KID_SKILLS[s] ?? 99))) return { ok: false, reason: `too young for ${common.join('/')}` };
    if (t.minutes > 30) return { ok: false, reason: 'too long for a child' };
  }

  if (m.role === 'helper') {
    const { time, weekday } = hm(when, tz);
    if (m.dayOff?.includes(weekday)) return { ok: false, reason: 'helper day off' };
    if (m.workHours && (time < m.workHours.from || time > m.workHours.to)) return { ok: false, reason: 'outside helper working hours' };
  }

  // Availability calendar check (default 08:00–22:00 every day)
  {
    const { time, weekday } = hm(when, tz);
    if (m.availability?.length) {
      const slot = m.availability.find(a => a.day === weekday && time >= a.from && time <= a.to);
      if (!slot) return { ok: false, reason: 'outside availability window' };
    } else if (m.role !== 'helper') {
      // Default availability: 08:00–22:00 for non-helpers without explicit schedule
      if (time < '08:00' || time > '22:00') return { ok: false, reason: 'outside default hours (08:00–22:00)' };
    }
  }

  // skills on a task are alternative ways to do it (drive OR walk); a member needs at least one
  if (t.skills.length && !t.skills.some(s => m.skills.includes(s))) return { ok: false, reason: 'missing skill' };

  if (opts.openTasksToday >= m.dailyLimit) return { ok: false, reason: 'daily limit reached' };

  if (t.dueAt) {
    const due = new Date(t.dueAt).getTime();
    const clash = m.busy.find(b => due >= new Date(b.from).getTime() && due <= new Date(b.to).getTime());
    if (clash) return { ok: false, reason: `busy: ${clash.what ?? 'calendar'}` };

    // dueAt collision: check if member already has a task overlapping this time window
    if (opts.existingTasks) {
      const windowMs = t.minutes * 60_000;
      const taskStart = due - windowMs / 2;
      const taskEnd = due + windowMs / 2;
      const overlap = opts.existingTasks.find(other =>
        other.id !== t.id &&
        other.assigneeId === m.id &&
        ['assigned', 'accepted'].includes(other.status) &&
        other.dueAt &&
        (() => {
          const otherDue = new Date(other.dueAt!).getTime();
          const otherHalf = (other.minutes * 60_000) / 2;
          return otherDue - otherHalf < taskEnd && otherDue + otherHalf > taskStart;
        })()
      );
      if (overlap) return { ok: false, reason: `time collision with "${overlap.text}"` };
    }
  }
  return { ok: true };
}
