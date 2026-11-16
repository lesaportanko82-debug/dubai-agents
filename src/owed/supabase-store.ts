import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { InMemoryStore, type AuditEntry, type StoreData } from './store';
import type { Claim, Contract, DefectCase, ScoreSettings } from './types';
import { demoData } from './seed';

type Kind = 'supplier' | 'contract' | 'batch' | 'delivery' | 'order' | 'case' | 'claim' | 'settings' | 'audit' | 'run';

/**
 * OWED document store on Supabase: one row per entity in `owed_docs`.
 * Reads the whole (small) dataset once per request into memory; every write goes straight to the database.
 */
export class OwedDb {
  constructor(private sb: SupabaseClient) {}

  static fromEnv(): OwedDb | undefined {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) return undefined;
    return new OwedDb(createClient(url, key, { auth: { persistSession: false } }));
  }

  private async all(): Promise<{ kind: Kind; id: string; data: any }[]> {
    const out: { kind: Kind; id: string; data: any }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.sb.from('owed_docs').select('kind,id,data').range(from, from + 999);
      if (error) throw new Error(`owed_docs: ${error.message}`);
      out.push(...((data ?? []) as any));
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  async upsert(kind: Kind, id: string, data: unknown) {
    const { error } = await this.sb.from('owed_docs').upsert({ kind, id, data, updated_at: new Date().toISOString() });
    if (error) throw new Error(`owed_docs upsert: ${error.message}`);
  }

  async bulk(rows: { kind: Kind; id: string; data: unknown }[]) {
    for (let i = 0; i < rows.length; i += 400) {
      const { error } = await this.sb.from('owed_docs').upsert(rows.slice(i, i + 400).map(r => ({ ...r, updated_at: new Date().toISOString() })));
      if (error) throw new Error(`owed_docs seed: ${error.message}`);
    }
  }

  /** Fill an empty store with the synthetic plumbing demo. */
  async seed(nowIso = new Date().toISOString()) {
    const d = demoData(nowIso);
    await this.bulk([
      ...d.suppliers.map(x => ({ kind: 'supplier' as const, id: x.id, data: x })),
      ...d.contracts.map(x => ({ kind: 'contract' as const, id: x.id, data: x })),
      ...d.batches.map(x => ({ kind: 'batch' as const, id: x.id, data: x })),
      ...d.deliveries.map(x => ({ kind: 'delivery' as const, id: x.id, data: x })),
      ...d.orders.map(x => ({ kind: 'order' as const, id: x.orderNo, data: x })),
      ...d.cases.map(x => ({ kind: 'case' as const, id: x.id, data: x })),
      ...d.claims.map(x => ({ kind: 'claim' as const, id: x.id, data: x })),
      { kind: 'settings' as const, id: 'main', data: d.settings },
      ...d.audit.map(x => ({ kind: 'audit' as const, id: `${x.at}-${randomUUID().slice(0, 6)}`, data: x })),
    ]);
  }

  /** Wipe everything and seed the demo again. */
  async reset() {
    const { error } = await this.sb.from('owed_docs').delete().neq('kind', '__none__');
    if (error) throw new Error(`owed_docs reset: ${error.message}`);
    await this.seed();
  }

  async store(): Promise<SupabaseOwedStore> {
    let rows = await this.all();
    if (!rows.some(r => r.kind === 'supplier')) {
      await this.seed();
      rows = await this.all();
    }
    const of = <T,>(k: Kind) => rows.filter(r => r.kind === k).map(r => r.data as T);
    const data: StoreData = {
      suppliers: of('supplier'), contracts: of('contract'), batches: of('batch'), deliveries: of('delivery'),
      orders: of('order'), cases: of('case'), claims: of('claim'), settings: of<ScoreSettings>('settings')[0], audit: of('audit'),
    };
    const runs = of<{ id: string; at: string }>('run').sort((a, b) => b.at.localeCompare(a.at));
    return new SupabaseOwedStore(this, data, runs);
  }
}

export class SupabaseOwedStore extends InMemoryStore {
  constructor(private db: OwedDb, data: StoreData, public runs: any[]) { super(data); }
  override async saveCase(c: DefectCase) { await super.saveCase(c); await this.db.upsert('case', c.id, c); }
  override async saveCases(cs: DefectCase[]) { await super.saveCases(cs); await this.db.bulk(cs.map(c => ({ kind: 'case' as const, id: c.id, data: c }))); }
  override async saveClaim(c: Claim) { await super.saveClaim(c); await this.db.upsert('claim', c.id, c); }
  override async saveContract(c: Contract) { await super.saveContract(c); await this.db.upsert('contract', c.id, c); }
  override async saveSettings(s: ScoreSettings) { await super.saveSettings(s); await this.db.upsert('settings', 'main', s); }
  override async audit(e: AuditEntry) { await super.audit(e); await this.db.upsert('audit', `${e.at}-${randomUUID().slice(0, 6)}`, e); }
  async saveRun(run: { id: string; at: string }) { this.runs.unshift(run); await this.db.upsert('run', run.id, run); }
}
