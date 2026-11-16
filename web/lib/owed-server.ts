/**
 * Server-side OWED state for the panel: the Supabase document store (persistent across
 * requests and instances), or an in-memory synthetic demo when Supabase is not configured.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { InMemoryStore } from '@core/owed/store';
import { OwedDb, type SupabaseOwedStore } from '@core/owed/supabase-store';
import { demoData } from '@core/owed/seed';
import type { IntakeResult } from '@core/owed/agent';
import type { Role } from '@core/owed/types';

export interface RunRecord { id: string; at: string; input: string; result: IntakeResult }

declare global {
  // eslint-disable-next-line no-var
  var __owedMem: { store: InMemoryStore; runs: RunRecord[] } | undefined;
}

export const ROLES: Role[] = ['buyer', 'quality', 'service', 'management'];
export const ROLE_LABEL: Record<Role, { ru: string; en: string }> = {
  buyer: { ru: 'Закупщик', en: 'Buyer' },
  quality: { ru: 'Качество', en: 'Quality' },
  service: { ru: 'Сервисный центр', en: 'Service centre' },
  management: { ru: 'Руководство', en: 'Management' },
};

export function owedDb() { return OwedDb.fromEnv(); }

/** One load per request — layout and page share it. */
export const owedContext = cache(async () => {
  const jar = await cookies();
  const r = jar.get('owed_role')?.value as Role | undefined;
  const role: Role = r && ROLES.includes(r) ? r : 'buyer';
  const nowIso = new Date().toISOString();
  const db = owedDb();
  if (db) {
    const store = await db.store();
    return { store, runs: store.runs as RunRecord[], role, nowIso, persistent: true as const };
  }
  if (!globalThis.__owedMem) globalThis.__owedMem = { store: new InMemoryStore(demoData(nowIso)), runs: [] };
  return { store: globalThis.__owedMem.store, runs: globalThis.__owedMem.runs, role, nowIso, persistent: false as const };
});

export async function saveRun(run: RunRecord) {
  const ctx = await owedContext();
  if (ctx.persistent) await (ctx.store as SupabaseOwedStore).saveRun(run);
  else ctx.runs.unshift(run);
}

/** Back-compat for older imports. */
export async function owedState() { return owedContext(); }
