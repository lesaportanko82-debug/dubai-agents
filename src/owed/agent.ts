import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { INTAKE_SYSTEM } from './prompts.js';
import { redact } from './redact.js';
import type { Store } from './store.js';
import { attributeBatch } from './tools/attribution.js';
import { computeCaseCost } from './tools/cost.js';
import { decide } from './tools/decide.js';
import { withinFactoryWarranty } from './tools/warranty.js';
import type { DefectCase } from './types.js';

/* ---------- minimal model interface (Claude Messages API shape) ---------- */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };
export interface ModelResponse { stop_reason: string | null; content: ContentBlock[] }
export interface ModelClient {
  create(req: {
    model: string;
    max_tokens: number;
    system: string;
    tools: ToolDef[];
    messages: unknown[];
  }): Promise<ModelResponse>;
}
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }

/* ---------- tool schemas ---------- */
const FindBatchIn = z.object({ sku: z.string(), serial: z.number().int().nonnegative().optional() });
const DuplicateIn = z.object({ external_ref: z.string().min(1) });
const RecordCaseIn = z.object({
  sku: z.string(),
  serial: z.number().int().nonnegative().optional(),
  external_ref: z.string().optional(),
  description: z.string().min(5).max(400),
  defect_class: z.enum(['manufacturing', 'transport', 'installation', 'unknown']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(5).max(400),
  labour_cost: z.number().nonnegative().optional(),
  logistics_cost: z.number().nonnegative().optional(),
  compensation_cost: z.number().nonnegative().optional(),
});

export const INTAKE_TOOLS: ToolDef[] = [
  {
    name: 'check_duplicate',
    description: 'Check whether a complaint with this ticket / service-act number was already recorded from the same channel.',
    input_schema: { type: 'object', properties: { external_ref: { type: 'string' } }, required: ['external_ref'] },
  },
  {
    name: 'find_batch',
    description: 'Find the production batch and factory for a unit by SKU and (optionally) serial number. Returns attribution method, factory, shipment date and whether the factory warranty still applies.',
    input_schema: {
      type: 'object',
      properties: { sku: { type: 'string' }, serial: { type: 'integer', description: 'Serial number if stated' } },
      required: ['sku'],
    },
  },
  {
    name: 'record_case',
    description: 'Record the analysed case in the ledger. The system computes cost, recoverability and review status from your inputs and returns them.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        serial: { type: 'integer' },
        external_ref: { type: 'string', description: 'Ticket / service act number, no personal data' },
        description: { type: 'string', description: 'One neutral English sentence about the failure, no personal data' },
        defect_class: { type: 'string', enum: ['manufacturing', 'transport', 'installation', 'unknown'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        reasoning: { type: 'string', description: 'One sentence: why this class' },
        labour_cost: { type: 'number' },
        logistics_cost: { type: 'number' },
        compensation_cost: { type: 'number' },
      },
      required: ['sku', 'description', 'defect_class', 'confidence', 'reasoning'],
    },
  },
];

export interface TraceStep { tool: string; input: unknown; output: unknown }
export interface IntakeResult {
  summary: string;
  case?: DefectCase;
  duplicate?: boolean;
  trace: TraceStep[];
  redactions: number;
}

export interface IntakeOptions {
  channel: string;
  receivedAt?: string;
  model?: string;
  maxSteps?: number;
}

/**
 * Agent loop: the model plans and calls tools; code enforces money and business rules.
 */
export async function runIntake(client: ModelClient, store: Store, rawText: string, opts: IntakeOptions): Promise<IntakeResult> {
  const { text, removed } = redact(rawText);
  const receivedAt = opts.receivedAt ?? new Date().toISOString();
  const model = opts.model ?? process.env.OWED_MODEL ?? 'claude-sonnet-5-5';
  const trace: TraceStep[] = [];
  let recorded: DefectCase | undefined;
  let duplicate = false;

  const messages: any[] = [{ role: 'user', content: `Channel: ${opts.channel}\nReceived: ${receivedAt}\n\nComplaint:\n${text}` }];

  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    const res = await client.create({ model, max_tokens: 1024, system: INTAKE_SYSTEM, tools: INTAKE_TOOLS, messages });
    messages.push({ role: 'assistant', content: res.content });

    const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || calls.length === 0) {
      const summary = res.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n').trim();
      return { summary, case: recorded, duplicate, trace, redactions: removed };
    }

    const results = [];
    for (const call of calls) {
      let output: unknown;
      let isError = false;
      try {
        output = await execTool(call.name, call.input);
      } catch (e: any) {
        output = { error: e?.message ?? String(e) };
        isError = true;
      }
      trace.push({ tool: call.name, input: call.input, output });
      results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(output), is_error: isError });
    }
    messages.push({ role: 'user', content: results });
  }

  return { summary: 'Stopped: step limit reached; case sent to human review.', case: recorded, duplicate, trace, redactions: removed };

  /* ---------- tool executors ---------- */
  async function execTool(name: string, input: unknown): Promise<unknown> {
    if (name === 'check_duplicate') {
      const { external_ref } = DuplicateIn.parse(input);
      const existing = await store.findCaseByRef(opts.channel, external_ref);
      duplicate = !!existing;
      return existing ? { duplicate: true, case_id: existing.id, status: existing.status } : { duplicate: false };
    }

    if (name === 'find_batch') {
      const { sku, serial } = FindBatchIn.parse(input);
      const [batches, suppliers] = await Promise.all([store.batches(), store.suppliers()]);
      const a = attributeBatch(batches, sku, serial);
      if (!a.batch) return { found: false, method: a.method };
      const s = suppliers.find(x => x.id === a.batch!.supplierId)!;
      return {
        found: true,
        method: a.method,
        candidate_batches: a.candidates,
        batch: a.batch.code,
        factory: s.code,
        shipped_at: a.batch.shippedAt,
        factory_warranty_months: s.warrantyMonths,
        within_factory_warranty: withinFactoryWarranty(a.batch, s, receivedAt),
      };
    }

    if (name === 'record_case') {
      if (recorded) throw new Error('record_case already called for this complaint');
      const inp = RecordCaseIn.parse(input);
      const [batches, suppliers] = await Promise.all([store.batches(), store.suppliers()]);
      // re-derive attribution server-side — never trust the model's batch claim
      const a = attributeBatch(batches, inp.sku, inp.serial);
      const sup = a.batch ? suppliers.find(s => s.id === a.batch!.supplierId) : undefined;
      const inWarranty = a.batch && sup ? withinFactoryWarranty(a.batch, sup, receivedAt) : undefined;
      const cost = computeCaseCost(a.batch, { labour: inp.labour_cost, logistics: inp.logistics_cost, compensation: inp.compensation_cost });
      const d = decide({ defectClass: inp.defect_class, confidence: inp.confidence, attribution: a.method, hasBatch: !!a.batch, withinFactoryWarranty: inWarranty });

      const c: DefectCase = {
        id: randomUUID(),
        externalRef: inp.external_ref,
        channel: opts.channel,
        receivedAt,
        sku: inp.sku,
        serial: inp.serial,
        batchId: a.batch?.id,
        supplierId: a.batch?.supplierId,
        attribution: a.method,
        description: redact(inp.description).text,
        defectClass: inp.defect_class,
        confidence: inp.confidence,
        reasoning: redact(inp.reasoning).text,
        cost,
        recoverable: d.recoverable,
        needsReview: d.needsReview,
        reviewReasons: d.reviewReasons,
        status: d.status,
      };
      await store.saveCase(c);
      await store.audit({ at: new Date().toISOString(), actor: 'agent', action: 'case.saved', entityId: c.id, details: { status: c.status, total: cost.total } });
      recorded = c;
      return {
        case_id: c.id,
        batch: a.batch?.code ?? null,
        factory: sup?.code ?? null,
        attribution: a.method,
        total_cost_usd: cost.total,
        recoverable: d.recoverable,
        status: d.status,
        review_reasons: d.reviewReasons,
      };
    }

    throw new Error(`Unknown tool ${name}`);
  }
}

/* ---------- Anthropic adapter ---------- */
export async function anthropicClient(): Promise<ModelClient> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const sdk = new Anthropic();
  return { create: req => sdk.messages.create(req as any) as unknown as Promise<ModelResponse> };
}
