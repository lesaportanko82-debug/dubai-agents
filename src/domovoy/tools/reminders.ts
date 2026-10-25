import type { Lang, Member, OutgoingMessage, Task } from '../types';

/** Reminder ladder relative to due time. Never addressed to the task author. */
export const LADDER = [
  { level: 1 as const, offsetMin: -30, kind: 'gentle' },
  { level: 2 as const, offsetMin: +15, kind: 'humorous' },
  { level: 3 as const, offsetMin: +60, kind: 'board' },
];

const TEXT: Record<Lang, Record<'gentle' | 'humorous' | 'board', (t: string, n: string) => string>> = {
  ru: {
    gentle: (t, n) => `${n}, через полчаса: ${t}. Напоминаю заранее, чтобы без спешки.`,
    humorous: (t) => `Домовёнок заглянул под диван — дело «${t}» всё ещё там. Выручишь?`,
    board: (t) => `«${t}» переехало на семейную доску. Дом надеется на тебя.`,
  },
  en: {
    gentle: (t, n) => `${n}, in half an hour: ${t}. An early heads-up so nothing is rushed.`,
    humorous: (t) => `The house spirit checked under the sofa — "${t}" is still there. Can you?`,
    board: (t) => `"${t}" moved to the family board. The house is counting on you.`,
  },
  tl: {
    gentle: (t, n) => `${n}, sa loob ng kalahating oras: ${t}. Paalala lang nang maaga.`,
    humorous: (t) => `Tiningnan ng Domovoy sa ilalim ng sofa — nandoon pa rin ang "${t}". Pwede ba?`,
    board: (t) => `Nailipat ang "${t}" sa family board. Umaasa ang bahay sa iyo.`,
  },
  ar: { gentle: (t, n) => `${n}، بعد نصف ساعة: ${t}.`, humorous: (t) => `ما زالت المهمة «${t}» بانتظارك.`, board: (t) => `انتقلت «${t}» إلى لوحة العائلة.` },
  tr: { gentle: (t, n) => `${n}, yarım saat sonra: ${t}.`, humorous: (t) => `"${t}" hâlâ seni bekliyor.`, board: (t) => `"${t}" aile panosuna taşındı.` },
  hi: { gentle: (t, n) => `${n}, आधे घंटे में: ${t}.`, humorous: (t) => `"${t}" अभी भी आपका इंतज़ार कर रहा है.`, board: (t) => `"${t}" फ़ैमिली बोर्ड पर चला गया.` },
};

/**
 * Given the clock, returns reminders due now for open tasks and the new reminder level per task.
 */
export function dueReminders(tasks: Task[], members: Member[], nowIso: string, _tz = 'Asia/Dubai'): { messages: OutgoingMessage[]; updates: { taskId: string; level: 1 | 2 | 3 }[] } {
  const now = new Date(nowIso).getTime();
  const byId = new Map(members.map(m => [m.id, m]));
  const messages: OutgoingMessage[] = [];
  const updates: { taskId: string; level: 1 | 2 | 3 }[] = [];

  for (const t of tasks) {
    if (!t.dueAt || !t.assigneeId) continue;
    if (!['assigned', 'accepted'].includes(t.status)) continue;
    if (t.assigneeId === t.authorId) continue; // never nag the author about their own task
    const due = new Date(t.dueAt).getTime();
    const m = byId.get(t.assigneeId);
    if (!m) continue;

    // highest step that is already due and not yet sent (skips stale lower steps if a tick was missed)
    const step = [...LADDER].reverse().find(s => t.reminderLevel < s.level && now >= due + s.offsetMin * 60_000);
    if (step) {
      const tx = (TEXT[m.lang] ?? TEXT.en)[step.kind as 'gentle'];
      messages.push({ at: nowIso, toId: m.id, lang: m.lang, text: tx(t.text, m.name), kind: 'reminder', taskId: t.id });
      updates.push({ taskId: t.id, level: step.level });
    }
  }
  return { messages, updates };
}
