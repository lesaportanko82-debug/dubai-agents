import type { Batch, Claim, Contract, DefectCase, Delivery, MarketplaceOrder, NegotiationPack, ScoreSettings, Supplier } from './types';
import { DEFAULT_SETTINGS } from './types';
import { DEMO_CONTRACTS, DEMO_DELIVERIES } from './fixtures';

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

/** Storage port. InMemoryStore for tests/evals; the Supabase document store in production. */
export interface Store {
  suppliers(): Promise<Supplier[]>;
  contracts(): Promise<Contract[]>;
  batches(): Promise<Batch[]>;
  deliveries(): Promise<Delivery[]>;
  orders(): Promise<MarketplaceOrder[]>;
  cases(): Promise<DefectCase[]>;
  claims(): Promise<Claim[]>;
  settings(): Promise<ScoreSettings>;
  auditLog(limit?: number): Promise<AuditEntry[]>;
  findCaseByRef(channel: string, ref: string): Promise<DefectCase | undefined>;
  saveCase(c: DefectCase): Promise<void>;
  /** Many cases at once (one round trip in production). */
  saveCases(cs: DefectCase[]): Promise<void>;
  saveClaim(c: Claim): Promise<void>;
  saveContract(c: Contract): Promise<void>;
  saveSettings(s: ScoreSettings): Promise<void>;
  savePack(p: NegotiationPack): Promise<void>;
  audit(e: AuditEntry): Promise<void>;
}

export interface StoreData {
  suppliers: Supplier[];
  batches: Batch[];
  contracts?: Contract[];
  deliveries?: Delivery[];
  orders?: MarketplaceOrder[];
  cases?: DefectCase[];
  claims?: Claim[];
  settings?: ScoreSettings;
  audit?: AuditEntry[];
}

export class InMemoryStore implements Store {
  private d: Required<StoreData>;
  private _packs: NegotiationPack[] = [];
  public get auditEntries() { return this.d.audit; }

  constructor(suppliersOrData: Supplier[] | StoreData, batches?: Batch[]) {
    const data: StoreData = Array.isArray(suppliersOrData)
      ? { suppliers: suppliersOrData, batches: batches ?? [], contracts: DEMO_CONTRACTS, deliveries: DEMO_DELIVERIES }
      : suppliersOrData;
    this.d = {
      suppliers: data.suppliers, batches: data.batches, contracts: data.contracts ?? [], deliveries: data.deliveries ?? [],
      orders: data.orders ?? [], cases: data.cases ?? [], claims: data.claims ?? [], settings: data.settings ?? DEFAULT_SETTINGS, audit: data.audit ?? [],
    };
  }

  async suppliers() { return this.d.suppliers; }
  async contracts() { return this.d.contracts; }
  async batches() { return this.d.batches; }
  async deliveries() { return this.d.deliveries; }
  async orders() { return this.d.orders; }
  async cases() { return this.d.cases; }
  async claims() { return this.d.claims; }
  async settings() { return this.d.settings; }
  async auditLog(limit = 200) { return [...this.d.audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit); }
  async findCaseByRef(channel: string, ref: string) {
    return this.d.cases.find(c => (c.channel === channel && c.externalRef === ref) || (c.sources ?? []).some(s => s.ref === ref));
  }
  async saveCase(c: DefectCase) { upsert(this.d.cases, c); }
  async saveCases(cs: DefectCase[]) { for (const c of cs) upsert(this.d.cases, c); }
  async saveClaim(c: Claim) { upsert(this.d.claims, c); }
  async saveContract(c: Contract) { upsert(this.d.contracts, c); }
  async saveSettings(s: ScoreSettings) { this.d.settings = s; }
  async savePack(p: NegotiationPack) { this._packs.push(p); }
  async audit(e: AuditEntry) { this.d.audit.push(e); }
  packs() { return this._packs; }
  /** Back-compat for older tests. */
  get auditLogEntries() { return this.d.audit; }
}

function upsert<T extends { id: string }>(xs: T[], x: T) {
  const i = xs.findIndex(y => y.id === x.id);
  if (i >= 0) xs[i] = x; else xs.push(x);
}
