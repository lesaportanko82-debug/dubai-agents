/**
 * Server-side Domovoy state for the panel: in-memory demo family with a seeded week,
 * so the board, fairness and decisions screens have content before the first live run.
 */
import { InMemoryDomovoyStore } from '@core/domovoy/store';
import { DEMO_FAMILY } from '@core/domovoy/fixtures';
import type { Task } from '@core/domovoy/types';
import type { DispatchResult } from '@core/domovoy/agent';

export interface DomovoyRun { id: string; at: string; authorId: string; input: string; result: DispatchResult }
interface State { store: InMemoryDomovoyStore; runs: DomovoyRun[] }

declare global {
  // eslint-disable-next-line no-var
  var __domovoyState: State | undefined;
}

export function domovoyState(): State {
  if (!globalThis.__domovoyState) {
    const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [...m.busy] })));
    seed(store);
    globalThis.__domovoyState = { store, runs: [] };
  }
  return globalThis.__domovoyState;
}

/** "Now" for the demo is anchored to the current week so the ledger always looks current. */
export function demoNow(): string { return new Date().toISOString(); }

function seed(store: InMemoryDomovoyStore) {
  const now = new Date();
  const day = (d: number, h: number, mnt = 0) => { const x = new Date(now); x.setUTCDate(x.getUTCDate() - d); x.setUTCHours(h, mnt, 0, 0); return x.toISOString(); };
  const mk = (id: string, p: Partial<Task>): Task => ({
    id, authorId: 'mum', text: '', minutes: 15, skills: [], kidSafe: false, candidateIds: [], declinedBy: [], status: 'done', reminderLevel: 0, createdAt: day(1, 5), ...p,
  });
  const rows: Task[] = [
    mk('s1', { text: 'Отвезти Тимура на футбол', assigneeId: 'dad', minutes: 50, skills: ['drive'], doneAt: day(1, 13), dueAt: day(1, 13) }),
    mk('s2', { text: 'Купить продукты на неделю', assigneeId: 'joy', minutes: 60, skills: ['shop'], doneAt: day(1, 8), dueAt: day(1, 8) }),
    mk('s3', { text: 'Полить цветы', assigneeId: 'son', minutes: 10, skills: ['water_plants'], kidSafe: true, doneAt: day(1, 14), dueAt: day(1, 14) }),
    mk('s4', { text: 'Записать Машу к стоматологу', assigneeId: 'mum', minutes: 15, doneAt: day(2, 7), dueAt: day(2, 7) }),
    mk('s5', { text: 'Помочь Тимуру с математикой', assigneeId: 'granny', minutes: 40, skills: ['homework_help'], doneAt: day(2, 14), dueAt: day(2, 14) }),
    mk('s6', { text: 'Забрать посылку', assigneeId: 'mum', minutes: 35, skills: ['drive'], doneAt: day(2, 12), dueAt: day(2, 12) }),
    mk('s7', { text: 'Купить лекарство бабушке', assigneeId: 'mum', minutes: 30, skills: ['pharmacy'], doneAt: day(3, 15), dueAt: day(3, 15) }),
    mk('s8', { text: 'Постирать форму', assigneeId: 'joy', minutes: 30, skills: ['laundry'], doneAt: day(3, 9), dueAt: day(3, 9) }),
    mk('s9', { text: 'Убрать игрушки', assigneeId: 'masha', minutes: 10, skills: ['tidy'], kidSafe: true, doneAt: day(3, 14), dueAt: day(3, 14) }),
    mk('s10', { text: 'Оплатить школу', assigneeId: 'mum', minutes: 20, doneAt: day(4, 8), dueAt: day(4, 8) }),
    mk('s11', { text: 'Покормить кота', assigneeId: 'son', minutes: 5, skills: ['feed_cat'], kidSafe: true, doneAt: day(0, 4), dueAt: day(0, 4) }),
    // open items for today
    mk('o1', { text: 'Забрать Машу из сада', assigneeId: 'dad', status: 'accepted', minutes: 40, skills: ['drive'], dueAt: day(0, 13), candidateIds: ['dad', 'mum'], assignReason: 'free at 17:00, did less this week' }),
    mk('o2', { text: 'Купить молоко и хлеб', assigneeId: 'joy', status: 'assigned', minutes: 20, skills: ['shop'], dueAt: day(0, 12), candidateIds: ['joy', 'dad'], assignReason: 'household chore within working hours' }),
    mk('o3', { text: 'Полить цветы на балконе', assigneeId: 'son', status: 'assigned', minutes: 10, skills: ['water_plants'], kidSafe: true, dueAt: day(0, 14), candidateIds: ['son', 'granny', 'joy'], assignReason: 'good chore for a child, free today', reminderLevel: 1 }),
  ];
  for (const t of rows) void store.saveTask(t);
}
