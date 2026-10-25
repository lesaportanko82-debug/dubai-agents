import type { Batch, DefectCase, NegotiationPack, Supplier } from './types.js';

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

/** Storage port. InMemoryStore for tests/evals; SupabaseStore for production (next step). */
export interface Store {
  suppliers(): Promise<Supplier[]>;
  batches(): Promise<Batch[]>;
  cases(): Promise<DefectCase[]>;
  findCaseByRef(channel: string, ref: string): Promise<DefectCase | undefined>;
  saveCase(c: DefectCase): Promise<void>;
  savePack(p: NegotiationPack): Promise<void>;
  audit(e: AuditEntry): Promise<void>;
}

export class InMemoryStore implements Store {
  private _cases: DefectCase[] = [];
  private _packs: NegotiationPack[] = [];
  public auditLog: AuditEntry[] = [];
  constructor(private _suppliers: Supplier[], private _batches: Batch[]) {}

  async suppliers() { return this._suppliers; }
  async batches() { return this._batches; }
  async cases() { return this._cases; }
  async findCaseByRef(channel: string, ref: string) {
    return this._cases.find(c => c.channel === channel && c.externalRef === ref);
  }
  async saveCase(c: DefectCase) {
    const i = this._cases.findIndex(x => x.id === c.id);
    if (i >= 0) this._cases[i] = c; else this._cases.push(c);
  }
  async savePack(p: NegotiationPack) { this._packs.push(p); }
  async audit(e: AuditEntry) { this.auditLog.push(e); }
  packs() { return this._packs; }
}
