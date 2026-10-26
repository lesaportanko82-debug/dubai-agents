import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ContentBlock, ModelClient, ToolDef, TraceStep } from '../owed/agent';
import { redact } from '../owed/redact';
import { defaultModel } from '../owed/llm';
import { buildDispatchSystem } from './prompts';
import type { DomovoyStore } from './store';
import type { Lang, Reminder, Task } from './types';
import { rankCandidates } from './tools/assign';
import { assignTask, buildContext } from './household';
import { KID_SKILLS } from './fixtures';
import { patternContext } from './memory';
import { getWeather, analyzeWeatherAlerts, formatWeatherForAgent } from './integrations';
import { checkCalendar, checkFamilyCalendars } from './integrations';
import { executeAction, requestApproval, touchesChild } from './approvals';
import { CURRENCIES, formatMoney, needsMoneyApproval, parseCurrency } from './policy';
import { PAYMENT_CATEGORIES, placeOrder, type PaymentCategory } from './payments';
import { profileContext, rememberFact, visibleFacts, type FactAccess, type FactKind } from './profile';
import { MERCHANTS, prepareCart } from './shopping';
import { decideAutonomy } from './learning';

/** Cyrillic → Latin, enough to match "timur" against "Тимур". */
const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const translit = (s: string) => s.split('').map(c => TR[c] ?? c).join('');

/** Models sometimes send null for optional fields; zod wants them absent. */
function stripNulls<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripNulls) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)])) as T;
  return v;
}

function hourIn(iso: string, tz: string): number {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(iso)));
}

/** Rate limits: max tasks an author may create per hour. */
const RATE_LIMIT: Record<string, number> = { child: 5, adult: 15, elder: 15, helper: 15 };

const ProposeIn = z.object({
  tasks: z.array(z.object({
    text: z.string().min(2).max(140),
    due_at: z.string().optional(),
    place: z.string().max(80).optional(),
    minutes: z.number().int().min(1).max(600),
    skills: z.array(z.string()).max(4),
    kid_safe: z.boolean(),
    recurring: z.enum(['daily', 'weekly']).optional(),
    urgent: z.boolean().optional(),
    about_member_id: z.string().optional(),
    needs_proof: z.boolean().optional(),
    private: z.boolean().optional(),
  })).min(1).max(8),
});
const AssignIn = z.object({ task_id: z.string(), member_id: z.string(), reason: z.string().min(3).max(200), message: z.string().min(3).max(400) });

const CheckPatternsIn = z.object({ member_id: z.string().optional() });
const PlanSequenceIn = z.object({
  goal: z.string().min(3).max(300),
  steps: z.array(z.object({
    description: z.string().min(2).max(200),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
  })).min(1).max(8),
});
const SetReminderIn = z.object({
  member_id: z.string(),
  text: z.string().min(2).max(200),
  remind_at: z.string(),
  recurring: z.enum(['daily', 'weekly', 'monthly']).optional(),
  task_id: z.string().optional(),
});
const EvaluateAlternativesIn = z.object({
  task_id: z.string(),
  criteria: z.string().optional(),
});

const CheckWeatherIn = z.object({
  city: z.string().optional(),
  country_code: z.string().optional(),
});
const CheckCalendarIn = z.object({
  member_id: z.string().optional(),
  hours_ahead: z.number().optional(),
});
const RescheduleIn = z.object({
  task_id: z.string(),
  new_due_at: z.string(),
  reason: z.string().min(3).max(200),
});
const PlaceOrderIn = z.object({
  merchant: z.string().min(2).max(80),
  category: z.enum(PAYMENT_CATEGORIES as [PaymentCategory, ...PaymentCategory[]]),
  amount: z.number().positive(),
  currency: z.string().optional(),
  items: z.string().min(2).max(200),
  task_id: z.string().optional(),
});
const PrepareCartIn = z.object({
  merchant: z.string().min(2).max(60),
  category: z.enum(PAYMENT_CATEGORIES as [PaymentCategory, ...PaymentCategory[]]).optional(),
  items: z.array(z.object({ text: z.string().min(1).max(80), qty: z.number().int().positive().optional(), est_price: z.number().nonnegative().optional() })).min(1).max(20),
  task_id: z.string().optional(),
});
const GetProfileIn = z.object({ kind: z.enum(['place', 'person', 'rule', 'recurring', 'other']).optional(), about_member_id: z.string().optional() });
const RememberFactIn = z.object({
  key: z.string().min(2).max(60),
  value: z.string().min(1).max(400),
  kind: z.enum(['place', 'person', 'rule', 'recurring', 'other']).optional(),
  about_member_id: z.string().optional(),
  access: z.enum(['family', 'adults', 'owner']).optional(),
});
const RequestApprovalIn = z.object({
  action: z.enum(['spend_money', 'cancel_task', 'share_outside', 'change_child_schedule', 'reschedule_task']),
  reason_ru: z.string().min(3).max(300),
  reason_en: z.string().min(3).max(300),
  task_id: z.string().optional(),
  amount: z.number().optional(),
  currency: z.string().optional(),
  purpose: z.string().optional(),
  new_due_at: z.string().optional(),
  what: z.string().optional(),
  to: z.string().optional(),
});

export const DISPATCH_TOOLS: ToolDef[] = [
  { name: 'get_family', description: "Family members with roles, ages, languages, skills, working hours and this week's load.", input_schema: { type: 'object', properties: {} } },
  {
    name: 'check_patterns',
    description: 'Retrieve learned behavioral patterns for a member (or all). Use BEFORE propose_tasks to make smarter assignments: decline patterns, preferred times, response speeds, pair affinities.',
    input_schema: { type: 'object', properties: { member_id: { type: 'string', description: 'Optional: specific member ID. Omit for all members.' } } },
  },
  {
    name: 'plan_sequence',
    description: 'Break a complex request into a multi-step plan. Use when the message implies multiple dependent actions (e.g. "organize a birthday party for Saturday" → check availability, create tasks, set reminders, coordinate). Returns a plan ID for tracking.',
    input_schema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What the plan achieves' },
        steps: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, tool: { type: 'string', description: 'Which tool to call for this step' }, args: { type: 'object', description: 'Arguments for the tool' } }, required: ['description', 'tool', 'args'] } },
      },
      required: ['goal', 'steps'],
    },
  },
  {
    name: 'set_reminder',
    description: 'Schedule a reminder for a member at a specific time. Can be one-time or recurring (daily/weekly/monthly). Use for "remind me", "напомни", medicine schedules, appointments.',
    input_schema: {
      type: 'object',
      properties: {
        member_id: { type: 'string' },
        text: { type: 'string', description: 'Reminder message in the member\'s language' },
        remind_at: { type: 'string', description: 'ISO 8601 timestamp' },
        recurring: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
        task_id: { type: 'string', description: 'Link to a task if relevant' },
      },
      required: ['member_id', 'text', 'remind_at'],
    },
  },
  {
    name: 'evaluate_alternatives',
    description: 'Re-rank candidates for a task with pattern-aware scoring. Shows WHY each candidate fits better or worse based on learned behavior: decline patterns, preferred times, workload, pair dynamics.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        criteria: { type: 'string', description: 'Optional extra criteria to consider' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'propose_tasks',
    description: 'Register the tasks you extracted from the message. Returns allowed candidates (ranked, with reasons) and blocked members per task.',
    input_schema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' }, due_at: { type: 'string', description: 'ISO 8601 with timezone offset, if known' }, place: { type: 'string' },
              minutes: { type: 'integer' }, skills: { type: 'array', items: { type: 'string', enum: Object.keys(KID_SKILLS) } },
              kid_safe: { type: 'boolean' }, recurring: { type: 'string', enum: ['daily', 'weekly'] },
              urgent: { type: 'boolean', description: 'Time-critical: picking up a person, medicine, a fixed appointment' },
              about_member_id: { type: 'string', description: 'If the task is about a family member (take granny to the clinic), their id — they will not be the executor' },
              needs_proof: { type: 'boolean', description: 'A photo is required to close it (author asked for proof, or outcome is hard to verify)' },
              private: { type: 'boolean', description: 'Private task: visible only to author, assignee, and admins. Auto-set for aboutMemberId tasks.' },
            },
            required: ['text', 'minutes', 'skills', 'kid_safe'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'check_weather',
    description: 'Get current weather + 12h forecast for the family location. Returns conditions, alerts (rain, storm, extreme heat) and proactive task suggestions (bring laundry in, take umbrella, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name (default: family location from household settings)' },
        country_code: { type: 'string', description: 'ISO country code (default: AE)' },
      },
    },
  },
  {
    name: 'check_calendar',
    description: 'Check Google Calendar availability for a family member (or all members). Shows busy/free slots, current status, and next free time. Use before assigning time-sensitive tasks.',
    input_schema: {
      type: 'object',
      properties: {
        member_id: { type: 'string', description: 'Specific member ID, or omit to check all members' },
        hours_ahead: { type: 'number', description: 'Hours to look ahead (default: 8)' },
      },
    },
  },
  {
    name: 'place_order',
    description: 'Order and PAY for something on the family card, inside the wallet rules (per-purchase limit, monthly cap, allowed categories, known merchants, what children may order). Use for "закажи / купи онлайн / order / buy": pass merchant, category, amount and currency as written, items. Within the rules → paid, receipt sent, refund button. Outside → the card declines and the parents get an approval; a blocked category is refused outright. If it returns need_address, ask the author for the delivery address once and store it with remember_fact(key="home").',
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string', description: 'Shop or service, e.g. Carrefour, Noon, Talabat' },
        category: { type: 'string', enum: PAYMENT_CATEGORIES },
        amount: { type: 'number' }, currency: { type: 'string', description: 'As written: AED, USD, дирхам, тенге, $…' },
        items: { type: 'string', description: 'What exactly' }, task_id: { type: 'string' },
      },
      required: ['merchant', 'category', 'amount', 'items'],
    },
  },
  {
    name: 'prepare_cart',
    description: `Shopping, the default for "закажи / купи / order / buy": the agent builds the cart (items, quantities, estimated prices if known, delivery address from the profile, search deep links into the merchant) and sends it to the person who can pay — the requester if an adult, otherwise a parent. They pay with one tap in the merchant app and press "paid"; the agent then creates "receive the delivery", verifies it arrived and reports. If the merchant accepts agent checkout the card also offers "pay from the family wallet" (rules in place_order apply). Known UAE merchants: ${MERCHANTS.map(m => m.name).join(', ')}; any other name works with a generic link. Use place_order directly ONLY when the author explicitly asks to pay from the family wallet.`,
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string' }, category: { type: 'string', enum: PAYMENT_CATEGORIES },
        items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, qty: { type: 'integer' }, est_price: { type: 'number', description: 'Estimated unit price in the family currency, only if the author said it or it is obvious' } }, required: ['text'] } },
        task_id: { type: 'string' },
      },
      required: ['merchant', 'items'],
    },
  },
  {
    name: 'get_profile',
    description: 'Household profile facts the AUTHOR is allowed to see: places (home, school:masha…), facts about people (shoe_size:son, allergy:son — medical facts only here, never in the system prompt), rules, recurring needs. Call before ordering food/medicine (allergies), buying clothes (sizes), or sending someone somewhere (addresses).',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['place', 'person', 'rule', 'recurring', 'other'] }, about_member_id: { type: 'string' } } },
  },
  {
    name: 'remember_fact',
    description: 'Store a fact the author just told you so nobody is asked twice: key like home, school:masha, shoe_size:son, allergy:son, quiet_hours (the part after ":" is the member ID from get_family, never a name); value as text copied from the author\'s words — the tool REFUSES values that are not in the message. Medical keys are adults-only; facts about a person default to owner+parents. Never invent a fact; if it is missing, ask.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' }, value: { type: 'string' }, kind: { type: 'string', enum: ['place', 'person', 'rule', 'recurring', 'other'] }, about_member_id: { type: 'string' }, access: { type: 'string', enum: ['family', 'adults', 'owner'] } },
      required: ['key', 'value'],
    },
  },
  {
    name: 'reschedule_task',
    description: 'Move an EXISTING open task (an id from get_family.open_tasks) to a new time. If there is no such task, say so and ask what exactly to move — never invent a task or ask someone to "arrange" the move. If the task touches a child (child executor, or the task is about a child) and the author is not a parent, this automatically becomes an approval request to the parents instead of a direct change. Returns what happened.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, new_due_at: { type: 'string', description: 'ISO 8601 with offset' }, reason: { type: 'string', description: 'One line: why move it' } },
      required: ['task_id', 'new_due_at', 'reason'],
    },
  },
  {
    name: 'request_approval',
    description: `Human checkpoint. NOT for shop orders (prepare_cart / place_order route money themselves — never combine them with this). Use for: money that is not a shop order — pocket money, paying a tutor, a fee, a transfer (spend_money — pass amount + currency as written; converted to the family currency, parents asked only above the threshold, otherwise just recorded); cancelling someone else's task (cancel_task), sending family data to someone outside the household (share_outside), or changing a child's fixed activity (change_child_schedule). Creates a pending decision for the right people (parents/admins) with approve/reject buttons and returns its id. Do not promise the outcome — say it is awaiting approval.`,
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['spend_money', 'cancel_task', 'share_outside', 'change_child_schedule', 'reschedule_task'] },
        reason_ru: { type: 'string', description: 'What exactly will happen if approved, in Russian, one or two lines' },
        reason_en: { type: 'string', description: 'Same in English' },
        task_id: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string', description: `ISO code or as written (${CURRENCIES.join(', ')}; дирхам, руб, тенге, $…)` }, purpose: { type: 'string' },
        new_due_at: { type: 'string' }, what: { type: 'string' }, to: { type: 'string' },
      },
      required: ['action', 'reason_ru', 'reason_en'],
    },
  },
  {
    name: 'assign',
    description: 'Assign one task to one ALLOWED member and send them your message. Returns confirmation (with the autonomy level and the learned reason behind it) or an error with the allowed list.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, member_id: { type: 'string' }, reason: { type: 'string', description: 'One line: why this person' }, message: { type: 'string', description: "Personal message in the recipient's language" } },
      required: ['task_id', 'member_id', 'reason', 'message'],
    },
  },
];

export interface DispatchResult { summary: string; tasks: Task[]; trace: TraceStep[]; redactions: number }

export async function runDispatch(client: ModelClient, store: DomovoyStore, authorId: string, rawText: string, opts: { now?: string; tz?: string; model?: string; maxSteps?: number; mode?: import('./types').HouseholdMode } = {}): Promise<DispatchResult> {
  const now = opts.now ?? new Date().toISOString();
  const tz = opts.tz ?? 'Asia/Dubai';
  const { text, removed } = redact(rawText);
  const members = await store.members();
  const author = members.find(m => m.id === authorId);
  if (!author) throw new Error('unknown author');
  const trace: TraceStep[] = [];
  const created: Task[] = [];

  // Build pattern + profile context for the system prompt (profile: only what this author may see, no medical)
  const patternCtx = (await patternContext(store)) + (await profileContext(store, author));

  const messages: any[] = [{ role: 'user', content: `From: ${author.name} (role: ${author.role}, id: ${author.id}${author.age ? ', age: ' + author.age : ''}${author.isAdmin ? ', admin' : ''})\nNow: ${now} (${tz})\n\nMessage:\n${text}` }];
  for (let step = 0; step < (opts.maxSteps ?? 10); step++) {
    const res = await client.create({ model: opts.model ?? defaultModel(), max_tokens: 2000, system: buildDispatchSystem(opts.mode ?? 'classic', { amount: store.moneyThreshold, currency: store.currency }) + patternCtx, tools: DISPATCH_TOOLS, messages });
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      const summary = res.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n').trim();
      return { summary, tasks: created, trace, redactions: removed };
    }
    const results = [];
    for (const call of calls) {
      let output: unknown; let isError = false;
      try { output = await exec(call.name, call.input); } catch (e: any) { output = { error: e?.message ?? String(e) }; isError = true; }
      trace.push({ tool: call.name, input: call.input, output });
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output), is_error: isError });
    }
    messages.push({ role: 'user', content: results });
  }
  return { summary: 'Stopped: step limit reached.', tasks: created, trace, redactions: removed };

  async function exec(name: string, rawInput: unknown): Promise<unknown> {
    const input = stripNulls(rawInput);
    if (name === 'get_family') {
      const ctx = await buildContext(store, now, tz);
      const open = (await store.tasks()).filter(t => ['new', 'assigned', 'accepted', 'unassigned'].includes(t.status)).slice(-30);
      return {
        timezone: tz,
        open_tasks: open.map(t => ({ id: t.id, text: t.text, due_at: t.dueAt, assignee_id: t.assigneeId, about_member_id: t.aboutMemberId, status: t.status })),
        members: members.map(m => ({ id: m.id, name: m.name, role: m.role, age: m.age, lang: m.lang, skills: m.skills, message_style: m.messageStyle, work_hours: m.workHours, day_off: m.dayOff, week_minutes: ctx.weekMinutes[m.id], open_today: ctx.openToday[m.id], busy: m.busy.map(b => `${b.from}–${b.to} ${b.what ?? ''}`.trim()) })),
        skills: Object.keys(KID_SKILLS),
      };
    }
    if (name === 'check_patterns') {
      const { member_id } = CheckPatternsIn.parse(input);
      const patterns = await store.patterns(member_id);
      const active = patterns.filter(p => p.active && p.confidence >= 0.3);
      if (!active.length) return { patterns: [], note: 'No behavioral patterns detected yet. Patterns emerge after 3+ interactions.' };
      return {
        patterns: active.map(p => ({
          member_id: p.memberId,
          type: p.patternType,
          confidence: Math.round(p.confidence * 100) + '%',
          data: p.data,
          observed: p.observedCount,
        })),
      };
    }
    if (name === 'plan_sequence') {
      const { goal, steps } = PlanSequenceIn.parse(input);
      const plan = {
        id: 'plan-' + randomUUID().slice(0, 8),
        householdId: store.householdId,
        triggerText: text,
        authorId,
        steps: steps.map((s, i) => ({ step: i + 1, tool: s.tool, args: s.args, status: 'pending' as const, description: s.description })),
        status: 'planning' as const,
        createdAt: now,
        data: { goal },
      };
      await store.savePlan(plan);
      return { plan_id: plan.id, goal, steps: plan.steps.length, note: 'Plan created. Execute each step using the listed tools.' };
    }
    if (name === 'set_reminder') {
      const r = SetReminderIn.parse(input);
      const m = members.find(x => x.id === r.member_id);
      if (!m) throw new Error('unknown member_id');
      const reminder: Reminder = {
        id: 'rem-' + randomUUID().slice(0, 8),
        householdId: store.householdId,
        memberId: r.member_id,
        text: r.text,
        remindAt: r.remind_at,
        recurring: r.recurring,
        status: 'pending',
        createdAt: now,
        taskId: r.task_id,
      };
      await store.saveReminder(reminder);
      return { ok: true, reminder_id: reminder.id, for: m.name, at: r.remind_at, recurring: r.recurring ?? 'one-time' };
    }
    if (name === 'evaluate_alternatives') {
      const { task_id, criteria } = EvaluateAlternativesIn.parse(input);
      const t = created.find(x => x.id === task_id) ?? (await store.tasks()).find(x => x.id === task_id);
      if (!t) throw new Error('unknown task_id');
      const ctx = await buildContext(store, now, tz);
      ctx.existingTasks = await store.tasks();
      const { allowed, blocked } = rankCandidates(members, t, ctx);
      // Enrich with pattern data
      const patterns = await store.patterns();
      const enriched = allowed.map(c => {
        const mp = patterns.filter(p => p.memberId === c.memberId && p.active);
        const hints: string[] = [];
        const decTime = mp.find(p => p.patternType === 'decline_time');
        if (decTime && t.dueAt) {
          const taskHour = hourIn(t.dueAt, tz);
          if ((decTime.data.hours as number[]).includes(taskHour)) hints.push(`⚠️ Often declines at ${taskHour}:00`);
        }
        const speed = mp.find(p => p.patternType === 'response_speed');
        if (speed) hints.push(`Avg response: ${speed.data.avgMinutes}min`);
        const rate = mp.find(p => p.patternType === 'completion_rate');
        if (rate) hints.push(`Completion: ${Math.round((rate.data.rate as number) * 100)}%`);
        const affinity = mp.find(p => p.patternType === 'pair_affinity' && p.data.partnerId === t.authorId);
        if (affinity) hints.push(`✓ Good pair with author`);
        const conflict = mp.find(p => p.patternType === 'pair_conflict' && p.data.partnerId === t.authorId);
        if (conflict) hints.push(`⚠️ Friction with author`);
        return { ...c, member_name: members.find(x => x.id === c.memberId)?.name, pattern_hints: hints };
      });
      return { task_id, candidates: enriched, blocked, criteria: criteria ?? 'default ranking + patterns' };
    }
    if (name === 'check_weather') {
      const { city, country_code } = CheckWeatherIn.parse(input);
      const weather = await getWeather({ city: city ?? 'Dubai' });
      const alerts = analyzeWeatherAlerts(weather);
      return formatWeatherForAgent(weather, alerts);
    }
    if (name === 'check_calendar') {
      const { member_id, hours_ahead } = CheckCalendarIn.parse(input);
      const hoursAhead = hours_ahead ?? 8;
      const from = now;
      const to = new Date(new Date(now).getTime() + hoursAhead * 3_600_000).toISOString();
      if (member_id) {
        const m = members.find(x => x.id === member_id);
        if (!m) throw new Error('unknown member_id');
        const avail = await checkCalendar({ memberId: m.id, memberName: m.name, calendarId: m.calendarId, from, to });
        return avail;
      }
      const calMembers = members.map(m => ({ id: m.id, name: m.name, calendarId: m.calendarId }));
      return await checkFamilyCalendars(calMembers, from, to);
    }
    if (name === 'propose_tasks') {
      const { tasks } = ProposeIn.parse(input);

      // Rate limit: count tasks created by this author in the last hour
      const allTasks = await store.tasks();
      const hourAgo = new Date(new Date(now).getTime() - 3_600_000).toISOString();
      const recentCount = allTasks.filter(t => t.authorId === authorId && t.createdAt >= hourAgo).length;
      const limit = RATE_LIMIT[author!.role] ?? 15;
      if (recentCount + tasks.length > limit) {
        throw new Error(`Rate limit: ${author!.role} can create max ${limit} tasks/hour. Already created ${recentCount} in the last hour.`);
      }

      const ctx = await buildContext(store, now, tz);
      ctx.existingTasks = allTasks;
      const out = [];
      for (const p of tasks) {
        // P2.1 Anti-farming: child self-tasks in quest mode → auto needsProof
        let needsProof = p.needs_proof;
        let childToChild = false;
        if (author!.role === 'child') {
          // quest mode: child creating tasks for themselves → require photo proof
          if ((opts.mode ?? 'classic') === 'quest') needsProof = true;
          // child→child: mark for adult confirmation warning
          // (we detect after ranking; flag it now)
          childToChild = true;
        }

        const t: Task = {
          id: 't-' + randomUUID().slice(0, 8), authorId, text: redact(p.text).text, dueAt: p.due_at, place: p.place, minutes: p.minutes, skills: p.skills,
          kidSafe: p.kid_safe, recurring: p.recurring, candidateIds: [], declinedBy: [], status: 'new', reminderLevel: 0, createdAt: now,
          urgent: p.urgent, aboutMemberId: p.about_member_id, needsProof,
          private: p.private || !!p.about_member_id || undefined,
        };

        // P2.2 Duplicate detection: warn if a similar active task exists in last 24h
        const dayAgo = new Date(new Date(now).getTime() - 86_400_000).toISOString();
        const similar = allTasks.filter(x =>
          x.id !== t.id &&
          !['done', 'cancelled'].includes(x.status) &&
          x.createdAt >= dayAgo &&
          (x.text.toLowerCase() === t.text.toLowerCase() || (t.skills.length > 0 && t.skills.every(s => x.skills.includes(s)) && x.skills.every(s => t.skills.includes(s))))
        );

        const { allowed, blocked } = rankCandidates(members, t, ctx);
        t.candidateIds = allowed.map(c => c.memberId);

        // P2.1: child→child assignments → auto needsProof, flag for adult confirmation
        let needsAdultConfirm = false;
        if (childToChild) {
          const childCandidates = allowed.filter(c => members.find(x => x.id === c.memberId)?.role === 'child');
          if (childCandidates.length > 0) {
            t.needsProof = true;
            needsAdultConfirm = true;
          }
        }

        await store.saveTask(t);
        await store.event({ at: now, taskId: t.id, actor: authorId, type: 'created', details: { text: t.text } });
        for (const b of blocked) await store.event({ at: now, taskId: t.id, actor: 'agent', type: 'blocked', details: b });
        created.push(t);
        out.push({ task_id: t.id, text: t.text,
          ...(similar.length ? { duplicate_warning: `Similar active task(s) exist: ${similar.map(s => `"${s.text}" (${s.status})`).join(', ')}. Consider skipping.` } : {}),
          ...(needsAdultConfirm ? { needs_adult_confirm: true, note: 'Child→child task: requires adult confirmation before closing. Photo proof auto-enabled.' } : {}),
          allowed: allowed.map(c => {
            const mem = members.find(x => x.id === c.memberId)!;
            const open = ctx.openToday[c.memberId] ?? 0;
            const nearLimit = open >= mem.dailyLimit - 1;
            return { member_id: c.memberId, score: c.score, why: c.reasons, ...(nearLimit ? { near_limit: true, open_today: open, daily_limit: mem.dailyLimit } : {}) };
          }), blocked });
      }
      return { tasks: out };
    }
    if (name === 'place_order') {
      const o = PlaceOrderIn.parse(input);
      const r = await placeOrder(store, { requestedBy: authorId, merchant: o.merchant, category: o.category, amount: o.amount, currency: o.currency, items: o.items, taskId: o.task_id }, now);
      const p = r.payment;
      return { outcome: r.outcome, payment_id: p.id, status: p.status, rule: p.rule, reason: p.reason.en, amount: formatMoney(p.amount, p.currency), in_wallet_currency: `${p.amountInWallet} ${store.currency}`, receipt: p.receiptUrl, provider_ref: p.providerRef,
        note: r.outcome === 'paid' ? 'Paid. Receipt already sent to the author and admins; just confirm in one line.'
          : r.outcome === 'pending_approval' ? 'Card declined by the family rules; parents got an approval. Tell the author it awaits the parents.'
          : r.outcome === 'need_address' ? 'Ask the author for the delivery address (one line), then remember_fact(key="home") and call place_order again.'
          : r.outcome === 'card_declined' ? 'The bank declined. Nothing charged. Tell the author.' : 'Refused by a hard rule. Tell the author why.' };
    }
    if (name === 'prepare_cart') {
      const c = PrepareCartIn.parse(input);
      const r = await prepareCart(store, { requestedBy: authorId, merchant: c.merchant, category: c.category, items: c.items, taskId: c.task_id }, now);
      const payer = members.find(m => m.id === r.cart.payerId);
      return { cart_id: r.cart.id, merchant: r.cart.merchant, lines: r.cart.lines.length, estimated_total: r.cart.estimatedTotal ? formatMoney(r.cart.estimatedTotal, r.cart.currency) : 'unknown', sent_to: payer?.name, delivery: r.cart.deliveryAddress ?? 'not set', wallet_eligible: r.walletEligible,
        note: `Cart card already sent to ${payer?.name} with links and buttons. Tell the author in one line${payer?.id !== authorId ? ` that ${payer?.name} will pay` : ''}; do not repeat the items.` };
    }
    if (name === 'get_profile') {
      const q = GetProfileIn.parse(input);
      const facts = await visibleFacts(store, author!, { kind: q.kind as FactKind | undefined, aboutMemberId: q.about_member_id });
      return { facts: facts.map(f => ({ key: f.key, value: f.value, kind: f.kind, about: f.aboutMemberId, access: f.access, source: f.source })), note: facts.length ? undefined : 'Nothing stored (or not visible to this person). Ask once, then remember_fact.' };
    }
    if (name === 'remember_fact') {
      const r = RememberFactIn.parse(input);
      // the fact must come from the author, not from the model: most of its words must appear in the message
      const words = r.value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2);
      const msg = text.toLowerCase();
      const found = words.filter(w => msg.includes(w)).length;
      if (words.length && found / words.length < 0.6) throw new Error(`Refused: "${r.value}" is not in the author's message. Never invent facts — ask the author and store what they answer.`);
      // key suffix after ':' must be a member id
      const suffix = r.key.includes(':') ? r.key.split(':')[1].toLowerCase() : undefined;
      if (suffix && !members.some(m => m.id.toLowerCase() === suffix)) {
        const byName = members.find(m => { const n = translit(m.name.toLowerCase()); return n.startsWith(suffix) || suffix.startsWith(n.slice(0, 4)) || m.name.toLowerCase().startsWith(suffix); });
        if (byName) r.key = r.key.split(':')[0] + ':' + byName.id; else throw new Error(`Unknown member "${suffix}" in key; use a member id: ${members.map(m => m.id).join(', ')}`);
        if (!r.about_member_id) r.about_member_id = byName.id;
      }
      const f = await rememberFact(store, author!, { key: r.key, value: redact(r.value).text, kind: r.kind as FactKind | undefined, aboutMemberId: r.about_member_id, access: r.access as FactAccess | undefined }, now);
      return { ok: true, key: f.key, access: f.access, note: 'Stored. Will not be asked again.' };
    }
    if (name === 'reschedule_task') {
      const r = RescheduleIn.parse(input);
      const all = await store.tasks();
      const t = created.find(x => x.id === r.task_id) ?? all.find(x => x.id === r.task_id);
      if (!t) throw new Error('unknown task_id');
      const kid = touchesChild(t, members);
      if (kid && !author!.isAdmin) {
        const ap = await requestApproval(store, { action: 'change_child_schedule', payload: { taskId: t.id, newDueAt: r.new_due_at },
          reason: { ru: `${author!.name} просит перенести «${t.text}» на ${r.new_due_at.slice(11, 16)}: ${r.reason}`, en: `${author!.name} asks to move "${t.text}" to ${r.new_due_at.slice(11, 16)}: ${r.reason}` },
          requestedBy: authorId, authorId: t.authorId, taskId: t.id }, now);
        return { ok: true, pending_approval: ap.id, approvers: ap.approverIds, note: 'Touches a child\'s schedule → parents must approve. Tell the author it is awaiting approval.' };
      }
      const res = await executeAction(store, 'reschedule_task', { taskId: t.id, newDueAt: r.new_due_at }, now, { decidedBy: authorId });
      return { ok: true, ...res, verification_at: t.verifyAt, note: 'Moved. The agent will verify it happened and report to the author.' };
    }
    if (name === 'request_approval') {
      const r = RequestApprovalIn.parse(input);
      const payload: Record<string, unknown> = {};
      if (r.task_id) payload.taskId = r.task_id;
      if (r.action === 'spend_money') {
        if (r.amount === undefined) throw new Error('amount required');
        const cur = parseCurrency(r.currency) ?? store.currency;
        const check = needsMoneyApproval(r.amount, cur, { currency: store.currency, moneyThreshold: store.moneyThreshold });
        Object.assign(payload, { amount: r.amount, currency: cur, purpose: r.purpose ?? '', inHouseholdCurrency: check.inHousehold });
        if (!check.needs) {
          // below the family threshold → no checkpoint, just an auditable record
          await executeAction(store, 'spend_money', payload, now, { decidedBy: authorId });
          return { ok: true, below_threshold: true, recorded: formatMoney(r.amount, cur), equals: formatMoney(check.inHousehold, store.currency), threshold: formatMoney(store.moneyThreshold, store.currency), note: 'Below the family threshold: recorded, no approval needed. Proceed with the task.' };
        }
      }
      if (r.action === 'reschedule_task' || r.action === 'change_child_schedule') { if (!r.new_due_at || !r.task_id) throw new Error('task_id and new_due_at required'); payload.newDueAt = r.new_due_at; }
      if (r.action === 'cancel_task' && !r.task_id) throw new Error('task_id required');
      if (r.action === 'share_outside') Object.assign(payload, { what: r.what ?? '', to: r.to ?? '' });
      const taskAuthor = r.task_id ? (await store.tasks()).find(x => x.id === r.task_id)?.authorId : undefined;
      const ap = await requestApproval(store, { action: r.action, payload, reason: { ru: r.reason_ru, en: r.reason_en }, requestedBy: authorId, authorId: taskAuthor ?? authorId, taskId: r.task_id }, now);
      return { ok: true, approval_id: ap.id, approvers: ap.approverIds.map(id => members.find(m => m.id === id)?.name ?? id), expires_at: ap.expiresAt, note: 'Pending. Tell the author who decides and that nothing happens until they approve.' };
    }
    if (name === 'assign') {
      const a = AssignIn.parse(input);
      const t = created.find(x => x.id === a.task_id);
      if (!t) throw new Error('unknown task_id');
      if (t.assigneeId) throw new Error('task already assigned');
      // Visible learning: how much history backs this choice, and say so to the author
      const decision = decideAutonomy({ tasks: await store.tasks(), patterns: await store.patterns(), members, chore: t, candidateId: a.member_id });
      t.decision = decision;
      await assignTask(store, t, a.member_id, a.reason, now, redact(a.message).text);
      const m = members.find(x => x.id === a.member_id)!;
      if (decision.level !== 'remind' && t.authorId !== a.member_id) {
        const au = members.find(x => x.id === authorId)!;
        await store.send({ at: now, toId: au.id, lang: au.lang, kind: 'info', taskId: t.id,
          text: au.lang === 'ru' ? `🧠 ${m.name} — «${t.text}»: ${decision.why.ru}` : `🧠 ${m.name} — "${t.text}": ${decision.why.en}` });
      }

      // P2.3 Mutual assignment detection: if B assigned a task to A within 5 min, warn both
      const fiveAgo = new Date(new Date(now).getTime() - 5 * 60_000).toISOString();
      const allTasks = await store.tasks();
      const mutual = allTasks.find(x =>
        x.id !== t.id &&
        x.authorId === a.member_id &&
        x.assigneeId === authorId &&
        x.assignedAt && x.assignedAt >= fiveAgo &&
        ['assigned', 'accepted'].includes(x.status)
      );
      if (mutual) {
        const authorMem = members.find(x => x.id === authorId)!;
        const mutualMsg = (lang: Lang) => lang === 'ru'
          ? `🔄 Вы с ${authorMem.id === authorId ? m.name : authorMem.name} назначили дела друг другу. Договоритесь, кто что делает.`
          : `🔄 You and ${authorMem.id === authorId ? m.name : authorMem.name} assigned tasks to each other. Agree who does what.`;
        await store.send({ at: now, toId: authorId, lang: authorMem.lang, kind: 'info', text: mutualMsg(authorMem.lang) });
        await store.send({ at: now, toId: a.member_id, lang: m.lang, kind: 'info', text: mutualMsg(m.lang) });
      }

      return { ok: true, task_id: t.id, assigned_to: m.name, lang: m.lang, autonomy: decision.level, confidence: decision.confidence, learned_reason: decision.why.en, ...(mutual ? { mutual_assignment_warning: true } : {}) };
    }
    throw new Error(`Unknown tool ${name}`);
  }
}
