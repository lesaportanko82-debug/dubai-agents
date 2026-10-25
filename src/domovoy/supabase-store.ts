/**
 * Supabase-backed persistence for Domovoy.
 *
 *  - SupabaseDomovoyStore: one household's members / tasks / events / outbox / runs (DomovoyStore).
 *  - DomovoyDb: cross-household directory — households, invites, chat ↔ member links,
 *    onboarding sessions, processed Telegram updates, panel magic-link sessions.
 *
 * The server talks to Postgres with the project's secret key; all dm_* tables have RLS on with
 * no policies, so the public key sees nothing. Tasks/events/runs are stored as JSON documents
 * with a few indexed columns, which keeps the core types the single source of truth.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import type { DomovoyStore } from './store';
import type { AgentPlan, DispatchRun, Goal, Household, Insight, Lang, Member, MessageStyle, OutgoingMessage, Pattern, Reminder, Task, TaskEvent } from './types';
import type { HouseholdMode } from './types';

type Row = Record<string, any>;

const memberFromRow = (r: Row): Member => ({
  id: r.id, name: r.name, role: r.role, age: r.age ?? undefined, lang: r.lang as Lang,
  telegramId: r.telegram_chat_id ?? undefined, skills: r.skills ?? [], dayOff: r.day_off?.length ? r.day_off : undefined,
  workHours: r.work_from && r.work_to ? { from: r.work_from, to: r.work_to } : undefined,
  busy: r.busy ?? [], dailyLimit: r.daily_limit ?? 3, isAdmin: !!r.is_admin,
  messageStyle: (r.message_style as MessageStyle) ?? 'direct',
  availability: r.availability?.length ? r.availability : undefined,
});
const memberToRow = (householdId: string, m: Member): Row => ({
  id: m.id, household_id: householdId, name: m.name, role: m.role, age: m.age ?? null, lang: m.lang,
  telegram_chat_id: m.telegramId ?? null, skills: m.skills, day_off: m.dayOff ?? [], work_from: m.workHours?.from ?? null, work_to: m.workHours?.to ?? null,
  busy: m.busy ?? [], daily_limit: m.dailyLimit, is_admin: !!m.isAdmin,
  message_style: m.messageStyle ?? 'direct',
  availability: m.availability ?? [],
});
const householdFromRow = (r: Row): Household => ({ id: r.id, name: r.name, tz: r.tz, lang: r.lang, inviteCode: r.invite_code, pin: r.pin ?? '', mode: (r.mode as HouseholdMode) ?? 'classic' });

const goalFromRow = (r: Row): Goal => ({
  id: r.id, householdId: r.household_id, title: r.title, targetMemberId: r.target_member_id,
  type: r.type, threshold: r.threshold, reward: r.reward, progress: r.progress, status: r.status,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const patternFromRow = (r: Row): Pattern => ({
  id: r.id, householdId: r.household_id, memberId: r.member_id, patternType: r.pattern_type,
  data: r.data, confidence: r.confidence, observedCount: r.observed_count,
  firstSeen: r.first_seen, lastSeen: r.last_seen, active: r.active,
});

const planFromRow = (r: Row): AgentPlan => ({
  id: r.id, householdId: r.household_id, triggerText: r.trigger_text, authorId: r.author_id,
  steps: r.steps, status: r.status, createdAt: r.created_at,
  completedAt: r.completed_at ?? undefined, data: r.data,
});

const reminderFromRow = (r: Row): Reminder => ({
  id: r.id, householdId: r.household_id, memberId: r.member_id, text: r.text,
  remindAt: r.remind_at, recurring: r.recurring ?? undefined, status: r.status,
  createdAt: r.created_at, taskId: r.task_id ?? undefined,
});

const insightFromRow = (r: Row): Insight => ({
  id: r.id, householdId: r.household_id, insightType: r.insight_type,
  targetMemberId: r.target_member_id ?? undefined, data: r.data,
  delivered: r.delivered, createdAt: r.created_at,
});

function fail(where: string, error: { message: string } | null) { if (error) throw new Error(`${where}: ${error.message}`); }

export class SupabaseDomovoyStore implements DomovoyStore {
  readonly householdId: string;
  readonly tz: string;
  readonly mode: HouseholdMode;
  private _members?: Member[];
  private _tasks?: Task[];
  private _events?: TaskEvent[];
  constructor(private sb: SupabaseClient, readonly household: Household) {
    this.householdId = household.id;
    this.tz = household.tz;
    this.mode = household.mode;
  }

  async members() {
    if (!this._members) {
      const { data, error } = await this.sb.from('dm_members').select('*').eq('household_id', this.householdId).order('created_at');
      fail('members', error);
      this._members = (data ?? []).map(memberFromRow);
    }
    return this._members;
  }
  async saveMember(m: Member) {
    const { error } = await this.sb.from('dm_members').upsert(memberToRow(this.householdId, m));
    fail('saveMember', error);
    this._members = undefined;
  }
  async removeMember(id: string) {
    const { error } = await this.sb.from('dm_members').delete().eq('household_id', this.householdId).eq('id', id);
    fail('removeMember', error);
    this._members = undefined;
  }

  async tasks() {
    if (!this._tasks) {
      const { data, error } = await this.sb.from('dm_tasks').select('data').eq('household_id', this.householdId).order('created_at');
      fail('tasks', error);
      this._tasks = (data ?? []).map(r => r.data as Task);
    }
    return this._tasks;
  }
  async saveTask(t: Task) {
    const { error } = await this.sb.from('dm_tasks').upsert({ id: t.id, household_id: this.householdId, status: t.status, assignee_id: t.assigneeId ?? null, due_at: t.dueAt ?? null, created_at: t.createdAt, data: t });
    fail('saveTask', error);
    if (this._tasks) { const i = this._tasks.findIndex(x => x.id === t.id); if (i >= 0) this._tasks[i] = t; else this._tasks.push(t); }
  }

  async event(e: TaskEvent) {
    const { error } = await this.sb.from('dm_events').insert({ household_id: this.householdId, at: e.at, task_id: e.taskId, actor: e.actor, type: e.type, details: e.details ?? null });
    fail('event', error);
    if (this._events) this._events.push(e);
  }
  async events() {
    if (!this._events) {
      const { data, error } = await this.sb.from('dm_events').select('*').eq('household_id', this.householdId).order('id').limit(2000);
      fail('events', error);
      this._events = (data ?? []).map(r => ({ at: r.at, taskId: r.task_id, actor: r.actor, type: r.type, details: r.details ?? undefined }));
    }
    return this._events;
  }

  async send(m: OutgoingMessage) {
    const { error } = await this.sb.from('dm_outbox').insert({ household_id: this.householdId, at: m.at, to_member: m.toId, lang: m.lang, text: m.text, kind: m.kind, task_id: m.taskId ?? null });
    fail('send', error);
  }
  private msgFromRow = (r: Row): OutgoingMessage => ({ id: r.id, at: r.at, toId: r.to_member, lang: r.lang, text: r.text, kind: r.kind, taskId: r.task_id ?? undefined });
  async outbox() {
    const { data, error } = await this.sb.from('dm_outbox').select('*').eq('household_id', this.householdId).order('id', { ascending: false }).limit(200);
    fail('outbox', error);
    return (data ?? []).map(this.msgFromRow).reverse();
  }
  async pending() {
    const { data, error } = await this.sb.from('dm_outbox').select('*').eq('household_id', this.householdId).is('delivered_at', null).order('id');
    fail('pending', error);
    return (data ?? []).map(this.msgFromRow);
  }
  async markDelivered(ids: (string | number)[]) {
    if (!ids.length) return;
    const { error } = await this.sb.from('dm_outbox').update({ delivered_at: new Date().toISOString() }).in('id', ids);
    fail('markDelivered', error);
  }

  async saveRun(r: DispatchRun) {
    const { error } = await this.sb.from('dm_runs').insert({ id: r.id, household_id: this.householdId, at: r.at, author_id: r.authorId, input: r.input, result: r.result });
    fail('saveRun', error);
  }
  async runs(limit = 20) {
    const { data, error } = await this.sb.from('dm_runs').select('*').eq('household_id', this.householdId).order('at', { ascending: false }).limit(limit);
    fail('runs', error);
    return (data ?? []).map(r => ({ id: r.id, at: r.at, authorId: r.author_id, input: r.input, result: r.result }));
  }

  async goals() {
    const { data, error } = await this.sb.from('dm_goals').select('*').eq('household_id', this.householdId).order('created_at');
    fail('goals', error);
    return (data ?? []).map(goalFromRow);
  }
  async saveGoal(g: Goal) {
    const { error } = await this.sb.from('dm_goals').upsert({
      id: g.id, household_id: this.householdId, title: g.title, target_member_id: g.targetMemberId,
      type: g.type, threshold: g.threshold, reward: g.reward, progress: g.progress, status: g.status,
      updated_at: new Date().toISOString(),
    });
    fail('saveGoal', error);
  }

  // ── Pillar 1: Memory & Learning — dm_patterns ──
  async patterns(memberId?: string) {
    let q = this.sb.from('dm_patterns').select('*').eq('household_id', this.householdId);
    if (memberId) q = q.eq('member_id', memberId);
    const { data, error } = await q.order('id');
    fail('patterns', error);
    return (data ?? []).map(patternFromRow);
  }
  async savePattern(p: Pattern) {
    const row: Row = {
      household_id: this.householdId, member_id: p.memberId, pattern_type: p.patternType,
      data: p.data, confidence: p.confidence, observed_count: p.observedCount,
      first_seen: p.firstSeen, last_seen: p.lastSeen, active: p.active,
    };
    if (p.id) row.id = p.id;
    const { data, error } = await this.sb.from('dm_patterns').upsert(row).select('id').single();
    fail('savePattern', error);
    if (!p.id && data) p.id = data.id;
  }

  // ── Pillar 2: Multi-step Reasoning — dm_agent_plans ──
  async plans(limit = 20) {
    const { data, error } = await this.sb.from('dm_agent_plans').select('*').eq('household_id', this.householdId).order('created_at', { ascending: false }).limit(limit);
    fail('plans', error);
    return (data ?? []).map(planFromRow);
  }
  async savePlan(p: AgentPlan) {
    const { error } = await this.sb.from('dm_agent_plans').upsert({
      id: p.id, household_id: this.householdId, trigger_text: p.triggerText, author_id: p.authorId,
      steps: p.steps, status: p.status, created_at: p.createdAt,
      completed_at: p.completedAt ?? null, data: p.data,
    });
    fail('savePlan', error);
  }

  // ── Pillar 3: Tool Use — dm_reminders ──
  async reminders(opts?: { memberId?: string; pending?: boolean }) {
    let q = this.sb.from('dm_reminders').select('*').eq('household_id', this.householdId);
    if (opts?.memberId) q = q.eq('member_id', opts.memberId);
    if (opts?.pending) q = q.eq('status', 'pending');
    const { data, error } = await q.order('remind_at');
    fail('reminders', error);
    return (data ?? []).map(reminderFromRow);
  }
  async saveReminder(r: Reminder) {
    const { error } = await this.sb.from('dm_reminders').upsert({
      id: r.id, household_id: this.householdId, member_id: r.memberId, text: r.text,
      remind_at: r.remindAt, recurring: r.recurring ?? null, status: r.status,
      created_at: r.createdAt, task_id: r.taskId ?? null,
    });
    fail('saveReminder', error);
  }

  // ── Pillar 4: Autonomous Loops — dm_insights ──
  async insights(opts?: { delivered?: boolean; limit?: number }) {
    let q = this.sb.from('dm_insights').select('*').eq('household_id', this.householdId);
    if (opts?.delivered !== undefined) q = q.eq('delivered', opts.delivered);
    const { data, error } = await q.order('id', { ascending: false }).limit(opts?.limit ?? 100);
    fail('insights', error);
    return (data ?? []).map(insightFromRow);
  }
  async saveInsight(i: Insight) {
    const row: Row = {
      household_id: this.householdId, insight_type: i.insightType,
      target_member_id: i.targetMemberId ?? null, data: i.data,
      delivered: i.delivered, created_at: i.createdAt,
    };
    if (i.id) row.id = i.id;
    const { data, error } = await this.sb.from('dm_insights').upsert(row).select('id').single();
    fail('saveInsight', error);
    if (!i.id && data) i.id = data.id;
  }
  async markInsightDelivered(id: number) {
    const { error } = await this.sb.from('dm_insights').update({ delivered: true }).eq('id', id);
    fail('markInsightDelivered', error);
  }
}

export interface ChatSession { householdId?: string; memberId?: string; state: Record<string, any> }

export class DomovoyDb {
  constructor(private sb: SupabaseClient) {}
  static fromEnv(): DomovoyDb | undefined {
    const url = process.env.SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) return undefined;
    return new DomovoyDb(createClient(url, key, { auth: { persistSession: false } }));
  }

  store(h: Household) { return new SupabaseDomovoyStore(this.sb, h); }

  async household(id: string): Promise<Household | undefined> {
    const { data } = await this.sb.from('dm_households').select('*').eq('id', id).maybeSingle();
    return data ? householdFromRow(data) : undefined;
  }
  async householdByInvite(code: string): Promise<Household | undefined> {
    const { data } = await this.sb.from('dm_households').select('*').eq('invite_code', code).maybeSingle();
    return data ? householdFromRow(data) : undefined;
  }
  async householdByPin(pin: string): Promise<Household | undefined> {
    const { data } = await this.sb.from('dm_households').select('*').eq('pin', pin).maybeSingle();
    return data ? householdFromRow(data) : undefined;
  }
  async allHouseholds(): Promise<Household[]> {
    const { data, error } = await this.sb.from('dm_households').select('*');
    fail('allHouseholds', error);
    return (data ?? []).map(householdFromRow);
  }
  async createHousehold(input: { name: string; tz: string; lang: Lang }): Promise<Household> {
    const { data, error } = await this.sb.from('dm_households').insert({ name: input.name, tz: input.tz, lang: input.lang }).select('*').single();
    fail('createHousehold', error);
    return householdFromRow(data!);
  }

  /** Which household and member does this chat belong to? */
  async memberByChat(chatId: string): Promise<{ household: Household; member: Member } | undefined> {
    const { data } = await this.sb.from('dm_members').select('*, dm_households(*)').eq('telegram_chat_id', chatId).maybeSingle();
    if (!data) return undefined;
    return { household: householdFromRow(data.dm_households), member: memberFromRow(data) };
  }
  async memberById(id: string): Promise<{ household: Household; member: Member } | undefined> {
    const { data } = await this.sb.from('dm_members').select('*, dm_households(*)').eq('id', id).maybeSingle();
    if (!data) return undefined;
    return { household: householdFromRow(data.dm_households), member: memberFromRow(data) };
  }

  async session(chatId: string): Promise<ChatSession> {
    const { data } = await this.sb.from('dm_tg_sessions').select('*').eq('chat_id', chatId).maybeSingle();
    return data ? { householdId: data.household_id ?? undefined, memberId: data.member_id ?? undefined, state: data.state ?? {} } : { state: {} };
  }
  async setSession(chatId: string, s: ChatSession) {
    const { error } = await this.sb.from('dm_tg_sessions').upsert({ chat_id: chatId, household_id: s.householdId ?? null, member_id: s.memberId ?? null, state: s.state, updated_at: new Date().toISOString() });
    fail('setSession', error);
  }

  /** true if this update was already processed */
  async seen(updateId: number): Promise<boolean> {
    const { error } = await this.sb.from('dm_tg_updates').insert({ update_id: updateId });
    if (!error) return false;
    if (error.code === '23505') return true;
    throw new Error(`seen: ${error.message}`);
  }

  async createPanelSession(householdId: string, memberId: string, ttlHours = 24 * 30): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    const { error } = await this.sb.from('dm_panel_sessions').insert({ token, household_id: householdId, member_id: memberId, expires_at: new Date(Date.now() + ttlHours * 3_600_000).toISOString() });
    fail('createPanelSession', error);
    return token;
  }
  async panelSession(token: string): Promise<{ household: Household; member: Member } | undefined> {
    const { data } = await this.sb.from('dm_panel_sessions').select('*, dm_households(*)').eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!data) return undefined;
    const m = await this.memberById(data.member_id);
    if (!m) return undefined;
    return { household: householdFromRow(data.dm_households), member: m.member };
  }
}

export const newMemberId = () => 'm_' + randomUUID().slice(0, 8);
