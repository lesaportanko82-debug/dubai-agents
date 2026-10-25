import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ContentBlock, ModelClient, ToolDef, TraceStep } from '../owed/agent';
import { redact } from '../owed/redact';
import { defaultModel } from '../owed/llm';
import { buildDispatchSystem } from './prompts';
import type { DomovoyStore } from './store';
import type { Task } from './types';
import { rankCandidates } from './tools/assign';
import { assignTask, buildContext } from './household';
import { KID_SKILLS } from './fixtures';

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
  })).min(1).max(8),
});
const AssignIn = z.object({ task_id: z.string(), member_id: z.string(), reason: z.string().min(3).max(200), message: z.string().min(3).max(400) });

export const DISPATCH_TOOLS: ToolDef[] = [
  { name: 'get_family', description: 'Family members with roles, ages, languages, skills, working hours and this week’s load.', input_schema: { type: 'object', properties: {} } },
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
            },
            required: ['text', 'minutes', 'skills', 'kid_safe'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'assign',
    description: 'Assign one task to one ALLOWED member and send them your message. Returns confirmation or an error with the allowed list.',
    input_schema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, member_id: { type: 'string' }, reason: { type: 'string', description: 'One line: why this person' }, message: { type: 'string', description: 'Personal message in the recipient’s language' } },
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

  const messages: any[] = [{ role: 'user', content: `From: ${author.name} (${author.role}, id ${author.id})\nNow: ${now} (${tz})\n\nMessage:\n${text}` }];
  for (let step = 0; step < (opts.maxSteps ?? 10); step++) {
    const res = await client.create({ model: opts.model ?? defaultModel(), max_tokens: 1500, system: buildDispatchSystem(opts.mode ?? 'classic'), tools: DISPATCH_TOOLS, messages });
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

  async function exec(name: string, input: unknown): Promise<unknown> {
    if (name === 'get_family') {
      const ctx = await buildContext(store, now, tz);
      return {
        timezone: tz,
        members: members.map(m => ({ id: m.id, name: m.name, role: m.role, age: m.age, lang: m.lang, skills: m.skills, message_style: m.messageStyle, work_hours: m.workHours, day_off: m.dayOff, week_minutes: ctx.weekMinutes[m.id], open_today: ctx.openToday[m.id], busy: m.busy.map(b => `${b.from}–${b.to} ${b.what ?? ''}`.trim()) })),
        skills: Object.keys(KID_SKILLS),
      };
    }
    if (name === 'propose_tasks') {
      const { tasks } = ProposeIn.parse(input);
      const ctx = await buildContext(store, now, tz);
      const out = [];
      for (const p of tasks) {
        const t: Task = {
          id: 't-' + randomUUID().slice(0, 8), authorId, text: redact(p.text).text, dueAt: p.due_at, place: p.place, minutes: p.minutes, skills: p.skills,
          kidSafe: p.kid_safe, recurring: p.recurring, candidateIds: [], declinedBy: [], status: 'new', reminderLevel: 0, createdAt: now,
          urgent: p.urgent, aboutMemberId: p.about_member_id, needsProof: p.needs_proof,
        };
        const { allowed, blocked } = rankCandidates(members, t, ctx);
        t.candidateIds = allowed.map(c => c.memberId);
        await store.saveTask(t);
        await store.event({ at: now, taskId: t.id, actor: authorId, type: 'created', details: { text: t.text } });
        for (const b of blocked) await store.event({ at: now, taskId: t.id, actor: 'agent', type: 'blocked', details: b });
        created.push(t);
        out.push({ task_id: t.id, text: t.text, allowed: allowed.map(c => ({ member_id: c.memberId, score: c.score, why: c.reasons })), blocked });
      }
      return { tasks: out };
    }
    if (name === 'assign') {
      const a = AssignIn.parse(input);
      const t = created.find(x => x.id === a.task_id);
      if (!t) throw new Error('unknown task_id');
      if (t.assigneeId) throw new Error('task already assigned');
      await assignTask(store, t, a.member_id, a.reason, now, redact(a.message).text);
      const m = members.find(x => x.id === a.member_id)!;
      return { ok: true, task_id: t.id, assigned_to: m.name, lang: m.lang };
    }
    throw new Error(`Unknown tool ${name}`);
  }
}
