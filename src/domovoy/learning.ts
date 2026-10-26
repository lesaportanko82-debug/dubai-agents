/**
 * Visible learning.
 *
 * Patterns (memory.ts) are only useful if the family can *see* the agent getting smarter.
 * This module turns patterns + history into an autonomy level per (task, person):
 *
 *   remind  — the agent has no evidence yet: it reminds / suggests and waits for a person.
 *   ask     — it has seen this a few times: it proposes a concrete executor with one-tap approval.
 *   act     — it has strong evidence: it assigns on its own and reports, with an undo button.
 *
 * Every decision carries a human-readable "why" and the evidence behind it, and /learned shows
 * each member how far the agent is from the next level ("2 more and I'll handle it myself").
 */
import type { DomovoyStore } from './store';
import type { AutonomyDecision, AutonomyLevel, Lang, Member, Pattern, Task } from './types';

export const AUTONOMY_THRESHOLDS = {
  askAfter: 1,      // this executor did this task at least once
  actAfter: 3,      // ... at least three times
  actScore: 0.7,
  askScore: 0.4,
  minCompletionRate: 0.75,
};

const norm = (s: string) => s.toLowerCase().replace(/[«»"”“.!?,]/g, '').trim();

/** Same chore? Exact normalized text, or an identical skill set for short skill-driven chores. */
export function sameChore(a: Pick<Task, 'text' | 'skills'>, b: Pick<Task, 'text' | 'skills'>): boolean {
  if (norm(a.text) === norm(b.text)) return true;
  if (a.skills.length && a.skills.length === b.skills.length && a.skills.every(s => b.skills.includes(s))) {
    // skill match counts only when the texts share a word (so "buy milk" ≠ "buy flowers")
    const wa = new Set(norm(a.text).split(/\s+/).filter(w => w.length > 3));
    return norm(b.text).split(/\s+/).some(w => wa.has(w));
  }
  return false;
}

/** History of this chore: who did it, how often, when last. */
export function choreHistory(tasks: Task[], chore: Pick<Task, 'text' | 'skills'>) {
  const same = tasks.filter(t => sameChore(t, chore)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = same.filter(t => t.status === 'done' && t.assigneeId);
  const byExecutor: Record<string, number> = {};
  for (const t of done) byExecutor[t.assigneeId!] = (byExecutor[t.assigneeId!] ?? 0) + 1;
  const usual = Object.entries(byExecutor).sort((a, b) => b[1] - a[1])[0];
  const declined = same.filter(t => t.declinedBy.length).length;
  return { same, done, byExecutor, usualExecutor: usual?.[0], usualCount: usual?.[1] ?? 0, declined, last: same[same.length - 1] };
}

/** Decide how autonomously to act for `chore` with `candidateId` as executor. */
export function decideAutonomy(opts: { tasks: Task[]; patterns: Pattern[]; members: Member[]; chore: Pick<Task, 'text' | 'skills' | 'authorId'>; candidateId: string }): AutonomyDecision {
  const { tasks, patterns, members, chore, candidateId } = opts;
  const cand = members.find(m => m.id === candidateId);
  const name = cand?.name ?? candidateId;
  const h = choreHistory(tasks, chore);
  const doneByCand = h.byExecutor[candidateId] ?? 0;
  const mp = patterns.filter(p => p.memberId === candidateId && p.active);
  const rate = mp.find(p => p.patternType === 'completion_rate')?.data.rate as number | undefined;
  const speed = mp.find(p => p.patternType === 'response_speed')?.data.avgMinutes as number | undefined;
  const affinity = patterns.find(p => p.patternType === 'pair_affinity' && p.active && ((p.memberId === candidateId && p.data.partnerId === chore.authorId) || (p.memberId === chore.authorId && p.data.partnerId === candidateId)));
  const avoids = mp.find(p => p.patternType === 'decline_skill');
  const avoidsThis = avoids && chore.skills.some(s => Object.keys(avoids.data.skills as Record<string, number>).includes(s));
  const recurring = patterns.find(p => p.patternType === 'recurring_task' && p.active && norm(String(p.data.text)) === norm(chore.text));

  let score = 0;
  const evidence: string[] = [];
  const ru: string[] = []; const en: string[] = [];
  if (doneByCand > 0) {
    // the first completion is the strongest signal; the rest build up to 0.5
    score += 0.25 + (Math.min(doneByCand, 5) - 1) / 4 * 0.25;
    evidence.push(`done_by_candidate:${doneByCand}/${h.done.length}`);
    ru.push(`${name} делал(а) это ${doneByCand} из ${h.done.length} последних раз`);
    en.push(`${name} did this ${doneByCand} of the last ${h.done.length} times`);
  }
  if (rate !== undefined) {
    score += rate * 0.3; evidence.push(`completion_rate:${rate}`);
    if (rate >= AUTONOMY_THRESHOLDS.minCompletionRate) { ru.push(`доводит до конца ${Math.round(rate * 100)}% дел`); en.push(`completes ${Math.round(rate * 100)}% of tasks`); }
    else { ru.push(`но доводит до конца только ${Math.round(rate * 100)}% дел`); en.push(`but completes only ${Math.round(rate * 100)}% of tasks`); }
  } else score += 0.2; // unknown: neutral
  if (speed !== undefined && speed <= 15) { score += 0.05; evidence.push(`response_speed:${speed}`); ru.push(`отвечает за ~${speed} мин`); en.push(`replies in ~${speed} min`); }
  if (affinity) { score += 0.1; evidence.push('pair_affinity'); ru.push(`хорошо сработан(а) с автором`); en.push(`works well with the author`); }
  if (recurring) { score += 0.05; evidence.push(`recurring_task:${recurring.data.count}`); }
  if (avoidsThis) { score -= 0.4; evidence.push('decline_skill'); ru.push(`обычно отказывается от таких дел`); en.push(`usually declines this kind of task`); }
  score = Math.max(0, Math.min(1, score));

  let level: AutonomyLevel = 'remind';
  if (score >= AUTONOMY_THRESHOLDS.actScore && doneByCand >= AUTONOMY_THRESHOLDS.actAfter && (rate ?? 1) >= AUTONOMY_THRESHOLDS.minCompletionRate && !avoidsThis) level = 'act';
  else if (score >= AUTONOMY_THRESHOLDS.askScore && doneByCand >= AUTONOMY_THRESHOLDS.askAfter && !avoidsThis) level = 'ask';

  const tail = level === 'act'
    ? { ru: '→ назначаю сам(а), отменить можно одной кнопкой.', en: '→ assigning on my own; one tap to undo.' }
    : level === 'ask'
      ? { ru: '→ предлагаю, жду одного «да».', en: '→ proposing; one "yes" is enough.' }
      : { ru: '→ пока только напоминаю: мало данных.', en: '→ for now I only remind: not enough history.' };
  const why = {
    ru: (ru.length ? ru.join(', ') + ' ' : '') + tail.ru,
    en: (en.length ? en.join(', ') + ' ' : '') + tail.en,
  };
  return { level, confidence: Math.round(score * 100) / 100, why, evidence };
}

/** How many more completions until the next level — the number a person can actually watch grow. */
export function nextLevelHint(decision: AutonomyDecision, doneByCand: number, lang: Lang): string {
  if (decision.level === 'act') return lang === 'ru' ? 'максимальный уровень: делаю сам' : 'top level: I handle it myself';
  const need = decision.level === 'ask' ? AUTONOMY_THRESHOLDS.actAfter - doneByCand : AUTONOMY_THRESHOLDS.askAfter - doneByCand;
  const n = Math.max(1, need);
  return lang === 'ru'
    ? `ещё ${n} ${n === 1 ? 'выполнение' : n < 5 ? 'выполнения' : 'выполнений'} — и ${decision.level === 'ask' ? 'буду назначать сам' : 'начну предлагать исполнителя'}`
    : `${n} more completion${n === 1 ? '' : 's'} and I will ${decision.level === 'ask' ? 'assign it myself' : 'start proposing an executor'}`;
}

/** Russian plural: 1 дело, 2 дела, 5 дел. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export interface LearningRow { text: string; executorId?: string; executorName?: string; level: AutonomyLevel; confidence: number; count: number; hint: string; why: string }

/** What the agent has learned about this household, chore by chore (for /learned and the panel). */
export async function learningReport(store: DomovoyStore, lang: Lang): Promise<{ rows: LearningRow[]; patterns: number; summary: string }> {
  const [tasks, patterns, members] = await Promise.all([store.tasks(), store.patterns(), store.members()]);
  const seen = new Set<string>();
  const rows: LearningRow[] = [];
  for (const t of [...tasks].reverse()) {
    const key = norm(t.text);
    if (seen.has(key)) continue;
    const h = choreHistory(tasks, t);
    if (h.same.length < 2) continue;
    seen.add(key);
    const executor = h.usualExecutor ?? t.assigneeId;
    if (!executor) continue;
    const d = decideAutonomy({ tasks, patterns, members, chore: t, candidateId: executor });
    rows.push({ text: t.text, executorId: executor, executorName: members.find(m => m.id === executor)?.name, level: d.level, confidence: d.confidence,
      count: h.byExecutor[executor] ?? 0, hint: nextLevelHint(d, h.byExecutor[executor] ?? 0, lang), why: lang === 'ru' ? d.why.ru : d.why.en });
  }
  rows.sort((a, b) => b.confidence - a.confidence);
  const act = rows.filter(r => r.level === 'act').length, ask = rows.filter(r => r.level === 'ask').length;
  const active = patterns.filter(p => p.active && p.confidence >= 0.3).length;
  const summary = lang === 'ru'
    ? `🧠 Я выучил ${active} ${plural(active, 'закономерность', 'закономерности', 'закономерностей')} и ${rows.length} ${plural(rows.length, 'повторяющееся дело', 'повторяющихся дела', 'повторяющихся дел')}: ${act} делаю сам, ${ask} предлагаю, ${rows.length - act - ask} пока напоминаю.`
    : `🧠 I have learned ${active} pattern${active === 1 ? '' : 's'} and ${rows.length} recurring chores: ${act} I handle myself, ${ask} I propose, ${rows.length - act - ask} I still only remind about.`;
  return { rows, patterns: active, summary };
}

export function formatLearning(rep: { rows: LearningRow[]; summary: string }, lang: Lang): string {
  const icon: Record<AutonomyLevel, string> = { act: '🟢', ask: '🟡', remind: '⚪' };
  const lines = [rep.summary];
  for (const r of rep.rows.slice(0, 8)) {
    lines.push(`${icon[r.level]} «${r.text}» → ${r.executorName ?? '—'} (${Math.round(r.confidence * 100)}%, ×${r.count}). ${r.hint}.`);
  }
  if (!rep.rows.length) lines.push(lang === 'ru' ? 'Пока мало истории — дайте мне неделю.' : 'Not much history yet — give me a week.');
  return lines.join('\n');
}
