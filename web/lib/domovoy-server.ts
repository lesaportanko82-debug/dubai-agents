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
    void seed(store);
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
  /** true when the panel shows the shared demo family (persisted in Supabase so every page and the bot see the same thing) */
  isDemo: boolean;
  /** false when Supabase is configured and there is no valid session → the layout redirects to login */
  authenticated: boolean;
  runs: DomovoyRun[];
}

export const DEMO_HOUSEHOLD_NAME = 'Demo · Домовёнок';

/**
 * The demo family lives in Supabase as a real household, so the panel, the dispatch API, the
 * scheduler tick and the bot all see one consistent state across serverless instances.
 * Created on first use and seeded with the same synthetic data as the in-memory demo.
 */
export async function ensureDemoHousehold(db: DomovoyDb): Promise<Household> {
  if (globalThis.__domovoyDemoHousehold) return globalThis.__domovoyDemoHousehold;
  // member ids are a global primary key, so the demo family gets its own prefix (demo_mum …)
  const demoMembers = () => DEMO_FAMILY.map(m => ({ ...m, id: 'demo_' + m.id, busy: [...m.busy], telegramId: undefined }));
  let h = (await db.allHouseholds()).find(x => x.name === DEMO_HOUSEHOLD_NAME);
  if (!h) {
    try { h = await db.createHousehold({ name: DEMO_HOUSEHOLD_NAME, tz: 'Asia/Dubai', lang: 'ru' }); }
    catch { h = (await db.allHouseholds()).find(x => x.name === DEMO_HOUSEHOLD_NAME); }   // lost the race: another instance created it
    if (!h) throw new Error('demo household unavailable');
  }
  const store = db.store(h);
  if (!(await store.members()).length) for (const m of demoMembers()) await store.saveMember(m);
  if (!(await store.tasks()).length) await seed(store, 'demo_');
  globalThis.__domovoyDemoHousehold = h;
  return h;
}

declare global {
  // eslint-disable-next-line no-var
  var __domovoyDemoHousehold: Household | undefined;
}

/**
 * Resolve the panel context: a valid dm_token cookie → that household (which may be the demo one);
 * Supabase without a session → demo household read-only context, not authenticated (layout redirects);
 * no Supabase → in-memory demo.
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
          const runs = (await store.runs(20)) as DomovoyRun[];
          return { store, household: session.household, member: session.member, isDemo: session.household.name === DEMO_HOUSEHOLD_NAME, authenticated: true, runs };
        }
      }
    } catch { /* cookies() may throw in some contexts */ }
    const demo = await ensureDemoHousehold(db);
    const store = db.store(demo);
    return { store, household: demo, isDemo: true, authenticated: false, runs: [] };
  }
  const state = domovoyState();
  return { store: state.store, isDemo: true, authenticated: true, runs: state.runs };
}

async function seed(store: DomovoyStore, prefix = '') {
  const pid = (x: string) => prefix + x;
  const now = new Date();
  const day = (d: number, h: number, mnt = 0) => { const x = new Date(now); x.setUTCDate(x.getUTCDate() - d); x.setUTCHours(h, mnt, 0, 0); return x.toISOString(); };
  const mk = (id: string, p: Partial<Task>): Task => ({
    id, authorId: pid('mum'), text: '', minutes: 15, skills: [], kidSafe: false, candidateIds: [], declinedBy: [], status: 'done', reminderLevel: 0, createdAt: day(1, 5), ...p,
  });
  const rows: Task[] = [
    mk('s1', { text: 'Отвезти Тимура на футбол', assigneeId: pid('dad'), minutes: 50, skills: ['drive'], doneAt: day(1, 13), dueAt: day(1, 13) }),
    mk('s2', { text: 'Купить продукты на неделю', assigneeId: pid('joy'), minutes: 60, skills: ['shop'], doneAt: day(1, 8), dueAt: day(1, 8) }),
    mk('s3', { text: 'Полить цветы', assigneeId: pid('son'), minutes: 10, skills: ['water_plants'], kidSafe: true, doneAt: day(1, 14), dueAt: day(1, 14) }),
    mk('s4', { text: 'Записать Машу к стоматологу', assigneeId: pid('mum'), minutes: 15, doneAt: day(2, 7), dueAt: day(2, 7) }),
    mk('s5', { text: 'Помочь Тимуру с математикой', assigneeId: pid('granny'), minutes: 40, skills: ['homework_help'], doneAt: day(2, 14), dueAt: day(2, 14) }),
    mk('s6', { text: 'Забрать посылку', assigneeId: pid('mum'), minutes: 35, skills: ['drive'], doneAt: day(2, 12), dueAt: day(2, 12) }),
    mk('s7', { text: 'Купить лекарство бабушке', assigneeId: pid('mum'), minutes: 30, skills: ['pharmacy'], doneAt: day(3, 15), dueAt: day(3, 15) }),
    mk('s8', { text: 'Постирать форму', assigneeId: pid('joy'), minutes: 30, skills: ['laundry'], doneAt: day(3, 9), dueAt: day(3, 9) }),
    mk('s9', { text: 'Убрать игрушки', assigneeId: pid('masha'), minutes: 10, skills: ['tidy'], kidSafe: true, doneAt: day(3, 14), dueAt: day(3, 14) }),
    mk('s10', { text: 'Оплатить школу', assigneeId: pid('mum'), minutes: 20, doneAt: day(4, 8), dueAt: day(4, 8) }),
    mk('s11', { text: 'Покормить кота', assigneeId: pid('son'), minutes: 5, skills: ['feed_cat'], kidSafe: true, doneAt: day(0, 4), dueAt: day(0, 4) }),
    // open items for today
    mk('o1', { text: 'Забрать Машу из сада', assigneeId: pid('dad'), status: 'accepted', minutes: 40, skills: ['drive'], dueAt: day(0, 13), candidateIds: [pid('dad'), pid('mum')], assignReason: 'free at 17:00, did less this week', urgent: true, aboutMemberId: pid('masha'), assignedAt: day(0, 5) }),
    mk('o2', { text: 'Купить молоко и хлеб', assigneeId: pid('joy'), status: 'assigned', minutes: 20, skills: ['shop'], dueAt: day(0, 12), candidateIds: [pid('joy'), pid('dad')], assignReason: 'household chore within working hours', assignedAt: new Date().toISOString() }),
    // an outdoor plan 4 hours from now: the rain showcase finds it, proposes a dry slot and asks the parents
    mk('o4', { text: 'Отвезти Тимура на футбол', assigneeId: pid('dad'), status: 'accepted', minutes: 50, skills: ['drive'], dueAt: new Date(now.getTime() + 4 * 3_600_000).toISOString(), candidateIds: [pid('dad'), pid('mum')], assignReason: 'drives, free in the afternoon', aboutMemberId: pid('son'), assignedAt: now.toISOString() }),
    mk('o3', { text: 'Полить цветы на балконе', assigneeId: pid('son'), status: 'accepted', minutes: 10, skills: ['water_plants'], kidSafe: true, dueAt: day(0, 14), candidateIds: [pid('son'), pid('granny'), pid('joy')], assignReason: 'good chore for a child, free today', reminderLevel: 1, needsProof: true, assignedAt: new Date().toISOString() }),
  ];
  for (const t of rows) await store.saveTask(t);
}
