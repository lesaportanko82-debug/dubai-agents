import type { DispatchRun, Member, OutgoingMessage, Task, TaskEvent } from './types';

export interface DomovoyStore {
  /** household this store is scoped to */
  readonly householdId: string;
  readonly tz: string;
  members(): Promise<Member[]>;
  saveMember(m: Member): Promise<void>;
  removeMember(id: string): Promise<void>;
  tasks(): Promise<Task[]>;
  saveTask(t: Task): Promise<void>;
  event(e: TaskEvent): Promise<void>;
  events(): Promise<TaskEvent[]>;
  send(m: OutgoingMessage): Promise<void>;
  /** everything ever queued (demo panel shows it) */
  outbox(): Promise<OutgoingMessage[]>;
  /** queued but not yet delivered to a channel */
  pending(): Promise<OutgoingMessage[]>;
  markDelivered(ids: (string | number)[]): Promise<void>;
  saveRun(r: DispatchRun): Promise<void>;
  runs(limit?: number): Promise<DispatchRun[]>;
}

export class InMemoryDomovoyStore implements DomovoyStore {
  readonly householdId: string;
  readonly tz: string;
  private _tasks: Task[] = [];
  private _events: TaskEvent[] = [];
  private _outbox: OutgoingMessage[] = [];
  private _runs: DispatchRun[] = [];
  private _seq = 0;
  constructor(private _members: Member[], opts: { householdId?: string; tz?: string } = {}) {
    this.householdId = opts.householdId ?? 'demo';
    this.tz = opts.tz ?? 'Asia/Dubai';
  }
  async members() { return this._members; }
  async saveMember(m: Member) {
    const i = this._members.findIndex(x => x.id === m.id);
    if (i >= 0) this._members[i] = m; else this._members.push(m);
  }
  async removeMember(id: string) { this._members = this._members.filter(m => m.id !== id); }
  async tasks() { return this._tasks; }
  async saveTask(t: Task) {
    const i = this._tasks.findIndex(x => x.id === t.id);
    if (i >= 0) this._tasks[i] = t; else this._tasks.push(t);
  }
  async event(e: TaskEvent) { this._events.push(e); }
  async events() { return this._events; }
  async send(m: OutgoingMessage) { this._outbox.push({ ...m, id: m.id ?? ++this._seq }); }
  async outbox() { return this._outbox; }
  private _delivered = new Set<string | number>();
  async pending() { return this._outbox.filter(m => !this._delivered.has(m.id!)); }
  async markDelivered(ids: (string | number)[]) { for (const id of ids) this._delivered.add(id); }
  async saveRun(r: DispatchRun) { this._runs.unshift(r); }
  async runs(limit = 20) { return this._runs.slice(0, limit); }
}
