import type { Member, OutgoingMessage, Task, TaskEvent } from './types';

export interface DomovoyStore {
  members(): Promise<Member[]>;
  tasks(): Promise<Task[]>;
  saveTask(t: Task): Promise<void>;
  event(e: TaskEvent): Promise<void>;
  events(): Promise<TaskEvent[]>;
  send(m: OutgoingMessage): Promise<void>;
  outbox(): Promise<OutgoingMessage[]>;
}

export class InMemoryDomovoyStore implements DomovoyStore {
  private _tasks: Task[] = [];
  private _events: TaskEvent[] = [];
  private _outbox: OutgoingMessage[] = [];
  constructor(private _members: Member[]) {}
  async members() { return this._members; }
  async tasks() { return this._tasks; }
  async saveTask(t: Task) {
    const i = this._tasks.findIndex(x => x.id === t.id);
    if (i >= 0) this._tasks[i] = t; else this._tasks.push(t);
  }
  async event(e: TaskEvent) { this._events.push(e); }
  async events() { return this._events; }
  async send(m: OutgoingMessage) { this._outbox.push(m); }
  async outbox() { return this._outbox; }
}
