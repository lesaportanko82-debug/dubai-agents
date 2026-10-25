/**
 * Server-side Domovoy state for the panel.
 *
 * Two modes:
 *  - Demo (no SUPABASE_URL): in-memory store seeded with a fake family + tasks.
 *  - Supabase: multi-household persistence, DomovoyDb resolves chat→household.
 */
import { InMemoryDomovoyStore } from '@core/domovoy/store';
import { DEMO_FAMILY } from '@core/domovoy/fixtures';
import type { DomovoyStore } from '@core/domovoy/store';
import type { Task, Household, Member } from '@core/domovoy/types';
import type { DispatchResult } from '@core/domovoy/agent';
import { DomovoyDb } from '@core/domovoy/supabase-store';
import { loadRootEnv } from './env';
import { cookies } from 'next/headers';

export interface DomovoyRun { id: string; at: string; authorId: string; input: string; result: DispatchResult }

// ---------- Demo (in-memory) state ----------
interface DemoState { store: InMemoryDomovoyStore; runs: DomovoyRun[]; lastTick?: number }

declare global {
  // eslint-disable-next-line no-var
  var __domovoyState: DemoState | undefined;
  // eslint-disable-next-line no-var
  var __domovoyDb: DomovoyDb | undefined;
}

export function domovoyState(): DemoState {
  if (!globalThis.__domovoyState) {
    const store = new InMemoryDomovoyStore(DEMO_FAMILY.map(m => ({ ...m, busy: [...m.busy] })));
    seed(store);
    globalThis.__domovoyState = { store, runs: [] };
  }
  return globalThis.__domovoyState;
}

/** Resolve the correct store for a panel request. `householdId` comes from magic-link token or query. */
export async function resolveStore(householdId?: string): Promise<DomovoyStore> {
  const db = getDomovoyDb();
  if (db && householdId) {
    const h = await db.household(householdId);
    if (h) return db.store(h);
  }
  // fallback to demo
  return domovoyState().store;
}

export function getDomovoyDb(): DomovoyDb | undefined {
  if (!globalThis.__domovoyDb) {
    loadRootEnv();
    globalThis.__domovoyDb = DomovoyDb.fromEnv();
  }
  return globalThis.__domovoyDb;
}

/** "Now" for the demo is anchored to the current week so the ledger always looks current. */
export function demoNow(): string { return new Date().toISOString(); }

export interface PanelContext {
  store: DomovoyStore;
  household?: Household;
  member?: Member;
  isDemo: boolean;
  runs: DomovoyRun[];
}

/**
 * Resolve the panel context: if a dm_token cookie is present and valid → Supabase store
 * for that household; otherwise → demo in-memory store.
 */
export async function panelContext(): Promise<PanelContext> {
  const db = getDomovoyDb();
  if (db) {
    try {
      const jar = await cookies();
      const token = jar.get('dm_token')?.value;
      if (token) {
        const session = await db.panelSession(token);
        if (session) {
          const store = db.store(session.household);
          return { store, household: session.household, member: session.member, isDemo: false, runs: [] };
        }
      }
    } catch { /* cookies() may throw in some contexts — fall through to demo */ }
  }
  const state = domovoyState();
  return { store: state.store, isDemo: true, runs: state.runs };
}

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
    mk('o1', { text: 'Забрать Машу из сада', assigneeId: 'dad', status: 'accepted', minutes: 40, skills: ['drive'], dueAt: day(0, 13), candidateIds: ['dad', 'mum'], assignReason: 'free at 17:00, did less this week', urgent: true, aboutMemberId: 'masha', assignedAt: day(0, 5) }),
    mk('o2', { text: 'Купить молоко и хлеб', assigneeId: 'joy', status: 'assigned', minutes: 20, skills: ['shop'], dueAt: day(0, 12), candidateIds: ['joy', 'dad'], assignReason: 'household chore within working hours', assignedAt: new Date().toISOString() }),
    mk('o3', { text: 'Полить цветы на балконе', assigneeId: 'son', status: 'accepted', minutes: 10, skills: ['water_plants'], kidSafe: true, dueAt: day(0, 14), candidateIds: ['son', 'granny', 'joy'], assignReason: 'good chore for a child, free today', reminderLevel: 1, needsProof: true, assignedAt: new Date().toISOString() }),
  ];
  for (const t of rows) void store.saveTask(t);
}
