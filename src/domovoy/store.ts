import type { AgentPlan, DispatchRun, Goal, HouseholdMode, Insight, Member, OutgoingMessage, Pattern, Reminder, Task, TaskEvent } from './types';

export interface DomovoyStore {
  /** household this store is scoped to */
  readonly householdId: string;
  readonly tz: string;
  readonly mode: HouseholdMode;
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
  /** Goals / rewards (gamification) */
  goals(): Promise<Goal[]>;
  saveGoal(g: Goal): Promise<void>;

  // ── Agent Pillars ──
  /** Pillar 1: Memory & Learning */
  patterns(memberId?: string): Promise<Pattern[]>;
  savePattern(p: Pattern): Promise<void>;
  /** Pillar 2: Multi-step Reasoning */
  plans(limit?: number): Promise<AgentPlan[]>;
  savePlan(p: AgentPlan): Promise<void>;
  /** Pillar 3: Tool Use — reminders */
  reminders(opts?: { memberId?: string; pending?: boolean }): Promise<Reminder[]>;
  saveReminder(r: Reminder): Promise<void>;
  /** Pillar 4: Autonomous Loops — insights */
  insights(opts?: { delivered?: boolean; limit?: number }): Promise<Insight[]>;
  saveInsight(i: Insight): Promise<void>;
  markInsightDelivered(id: number): Promise<void>;
}

export class InMemoryDomovoyStore implements DomovoyStore {
  readonly householdId: string;
  readonly tz: string;
  readonly mode: HouseholdMode;
  private _tasks: Task[] = [];
  private _events: TaskEvent[] = [];
  private _outbox: OutgoingMessage[] = [];
  private _runs: DispatchRun[] = [];
  private _goals: Goal[] = [];
  private _patterns: Pattern[] = [];
  private _plans: AgentPlan[] = [];
  private _reminders: Reminder[] = [];
  private _insights: Insight[] = [];
  private _insightSeq = 0;
  private _patternSeq = 0;
  private _seq = 0;
  constructor(private _members: Member[], opts: { householdId?: string; tz?: string; mode?: HouseholdMode } = {}) {
    this.householdId = opts.householdId ?? 'demo';
    this.tz = opts.tz ?? 'Asia/Dubai';
    this.mode = opts.mode ?? 'classic';
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
  async goals() { return this._goals; }
  async saveGoal(g: Goal) {
    const i = this._goals.findIndex(x => x.id === g.id);
    if (i >= 0) this._goals[i] = g; else this._goals.push(g);
  }

  // ── Agent Pillars ──
  async patterns(memberId?: string) {
    return memberId ? this._patterns.filter(p => p.memberId === memberId) : this._patterns;
  }
  async savePattern(p: Pattern) {
    if (!p.id) p.id = ++this._patternSeq;
    const i = this._patterns.findIndex(x => x.id === p.id);
    if (i >= 0) this._patterns[i] = p; else this._patterns.push(p);
  }
  async plans(limit = 20) { return this._plans.slice(0, limit); }
  async savePlan(p: AgentPlan) {
    const i = this._plans.findIndex(x => x.id === p.id);
    if (i >= 0) this._plans[i] = p; else this._plans.unshift(p);
  }
  async reminders(opts?: { memberId?: string; pending?: boolean }) {
    let r = this._reminders;
    if (opts?.memberId) r = r.filter(x => x.memberId === opts.memberId);
    if (opts?.pending) r = r.filter(x => x.status === 'pending');
    return r;
  }
  async saveReminder(r: Reminder) {
    const i = this._reminders.findIndex(x => x.id === r.id);
    if (i >= 0) this._reminders[i] = r; else this._reminders.push(r);
  }
  async insights(opts?: { delivered?: boolean; limit?: number }) {
    let r = this._insights;
    if (opts?.delivered !== undefined) r = r.filter(x => x.delivered === opts.delivered);
    return r.slice(0, opts?.limit ?? 100);
  }
  async saveInsight(i: Insight) {
    if (!i.id) i.id = ++this._insightSeq;
    const idx = this._insights.findIndex(x => x.id === i.id);
    if (idx >= 0) this._insights[idx] = i; else this._insights.push(i);
  }
  async markInsightDelivered(id: number) {
    const i = this._insights.find(x => x.id === id);
    if (i) i.delivered = true;
  }
}
