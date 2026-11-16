import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { INTAKE_SYSTEM } from './prompts';
import { redact } from './redact';
import type { Store } from './store';
import { attributeCase } from './tools/attribution';
import { computeCaseCost } from './tools/cost';
import { decide } from './tools/decide';
import { withinFactoryWarranty } from './tools/warranty';
import { findDuplicate } from './sqpm';
import type { DefectCase, SignalSource } from './types';
import { defaultModel } from './llm';

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
const opt = <T extends z.ZodTypeAny>(t: T) => z.preprocess(v => (v === null || v === '' ? undefined : v), t.optional());
const FindBatchIn = z.object({ sku: z.string(), serial: opt(z.number().int().nonnegative()), order_no: opt(z.string()), label_batch_code: opt(z.string()) });
const DuplicateIn = z.object({ external_ref: opt(z.string()), order_no: opt(z.string()), sku: opt(z.string()), serial: opt(z.number().int().nonnegative()) });
const DEFECT_CODES = ['cartridge_seal', 'coating', 'casting', 'thread', 'valve', 'heating_element', 'lid_hinge', 'switch', 'packaging', 'other'] as const;
const RecordCaseIn = z.object({
  sku: z.string(),
  serial: opt(z.number().int().nonnegative()),
  order_no: opt(z.string()),
  label_batch_code: opt(z.string()),
  external_ref: opt(z.string()),
  description: z.string().min(5).max(400),
  defect_class: z.enum(['manufacturing', 'transport', 'installation', 'unknown']),
  defect_code: opt(z.enum(DEFECT_CODES)),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(5).max(400),
  photos: opt(z.number().int().nonnegative()),
  labour_cost: opt(z.number().nonnegative()),
  logistics_cost: opt(z.number().nonnegative()),
  compensation_cost: opt(z.number().nonnegative()),
});
const LabelIn = z.object({ case_id: z.string() });

export const INTAKE_TOOLS: ToolDef[] = [
  {
    name: 'check_duplicate',
    description: 'Check whether this defect is already in the registry: same ticket/act number, or same marketplace order + SKU (+ customer) within the dedup window, or same serial. One defect seen in a review, a reclamation and a service act is ONE case.',
    input_schema: { type: 'object', properties: { external_ref: { type: 'string' }, order_no: { type: 'string' }, sku: { type: 'string' }, serial: { type: 'integer' } } },
  },
  {
    name: 'find_batch',
    description: 'Find the batch and factory and the attribution level: A (serial / batch code on the label), B (marketplace order ship date → only one factory in stock, or the SKU has one batch), C (several factories possible — analytics only), D (nothing — ask for a label photo).',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        serial: { type: 'integer', description: 'Serial number if stated' },
        order_no: { type: 'string', description: 'Marketplace order number if stated (WB-…, OZ-…)' },
        label_batch_code: { type: 'string', description: 'Batch code read from the label, e.g. B-2026-084' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'record_case',
    description: 'Record the analysed case. The system re-derives the batch and level, deduplicates, computes cost and decides recoverability — it returns what it decided.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Model as written; "не указан" if unknown' },
        serial: { type: 'integer' },
        order_no: { type: 'string' },
        label_batch_code: { type: 'string' },
        external_ref: { type: 'string', description: 'Ticket / service act number, no personal data' },
        description: { type: 'string', description: 'One neutral English sentence about the failure, no personal data' },
        defect_class: { type: 'string', enum: ['manufacturing', 'transport', 'installation', 'unknown'] },
        defect_code: { type: 'string', enum: [...DEFECT_CODES], description: 'Defect family, used to spot the same defect repeating across batches' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        reasoning: { type: 'string', description: 'One sentence: why this class' },
        photos: { type: 'integer', description: 'Number of photos attached, if mentioned' },
        labour_cost: { type: 'number' },
        logistics_cost: { type: 'number' },
        compensation_cost: { type: 'number' },
      },
      required: ['sku', 'description', 'defect_class', 'confidence', 'reasoning'],
    },
  },
  {
    name: 'request_label_photo',
    description: 'For a level D (or C) case: send the customer, through the support bot, a request for a photo of the product label with the batch number. Personal data is never included.',
    input_schema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'] },
  },
];

export interface TraceStep { tool: string; input: unknown; output: unknown }
export interface IntakeResult {
  summary: string;
  case?: DefectCase;
  duplicate?: boolean;
  merged?: boolean;
  trace: TraceStep[];
  redactions: number;
}

export interface IntakeOptions {
  channel: string;
  receivedAt?: string;
  model?: string;
  maxSteps?: number;
}

export const sourceOf = (channel: string): SignalSource =>
  channel === 'marketplace' ? 'marketplace' : channel === 'service_act' || channel === 'service_center' ? 'service_center' : 'reclamation';

/**
 * Agent loop: the model plans and calls tools; code enforces attribution levels, deduplication,
 * money and business rules.
 */
export async function runIntake(client: ModelClient, store: Store, rawText: string, opts: IntakeOptions): Promise<IntakeResult> {
  const { text, removed } = redact(rawText);
  const receivedAt = opts.receivedAt ?? new Date().toISOString();
  const model = opts.model ?? defaultModel();
  const trace: TraceStep[] = [];
  let recorded: DefectCase | undefined;
  let duplicate = false;
  let merged = false;

  const messages: any[] = [{ role: 'user', content: `Channel: ${opts.channel}\nReceived: ${receivedAt}\n\nComplaint:\n${text}` }];

  for (let step = 0; step < (opts.maxSteps ?? 7); step++) {
    const res = await client.create({ model, max_tokens: 1024, system: INTAKE_SYSTEM, tools: INTAKE_TOOLS, messages });
    messages.push({ role: 'assistant', content: res.content });

    const calls = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || calls.length === 0) {
      const summary = res.content.filter(b => b.type === 'text').map(b => (b as any).text).join('\n').trim();
      return { summary, case: recorded, duplicate, merged, trace, redactions: removed };
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

  return { summary: 'Stopped: step limit reached; case sent to human review.', case: recorded, duplicate, merged, trace, redactions: removed };

  /* ---------- tool executors ---------- */
  /** Level A needs a serial / batch code the customer actually gave: drop ones the model did not read in the complaint. */
  function grounded<T extends { serial?: number; label_batch_code?: string }>(q: T): T {
    const flat = rawText.toUpperCase().replace(/\s+/g, '');
    const out = { ...q };
    if (out.serial != null && !flat.includes(String(out.serial))) out.serial = undefined;
    if (out.label_batch_code && !flat.includes(out.label_batch_code.toUpperCase().replace(/\s+/g, ''))) out.label_batch_code = undefined;
    return out;
  }

  async function execTool(name: string, input: unknown): Promise<unknown> {
    const settings = await store.settings();

    if (name === 'check_duplicate') {
      const q = DuplicateIn.parse(input);
      const hit = findDuplicate(await store.cases(), { sku: q.sku ?? '', orderNo: q.order_no, serial: q.serial, receivedAt, externalRef: q.external_ref }, settings.dedupWindowDays);
      duplicate = !!hit;
      return hit ? { duplicate: true, matched_by: hit.by, case_id: hit.case.id, status: hit.case.status, sources: (hit.case.sources ?? []).map(s => s.source) } : { duplicate: false };
    }

    if (name === 'find_batch') {
      const q = grounded(FindBatchIn.parse(input));
      const [batches, suppliers, orders] = await Promise.all([store.batches(), store.suppliers(), store.orders()]);
      const a = attributeCase({ batches, orders }, { sku: q.sku, serial: q.serial, orderNo: q.order_no, labelBatchCode: q.label_batch_code });
      const s = a.batch ? suppliers.find(x => x.id === a.batch!.supplierId) : undefined;
      return {
        level: a.level,
        method: a.method,
        why: a.why,
        batch: a.level === 'A' || a.level === 'B' ? a.batch?.code ?? null : null,
        factory: a.level === 'A' || a.level === 'B' ? s?.code ?? null : null,
        candidate_factories: a.candidateSupplierIds.map(id => suppliers.find(x => x.id === id)?.code),
        within_factory_warranty: a.batch && s ? withinFactoryWarranty(a.batch, s, receivedAt) : null,
        claimable_level: a.level === 'A' || a.level === 'B',
      };
    }

    if (name === 'record_case') {
      if (recorded) throw new Error('record_case already called for this complaint');
      const inp = grounded(RecordCaseIn.parse(input));
      const [batches, suppliers, orders, cases] = await Promise.all([store.batches(), store.suppliers(), store.orders(), store.cases()]);
      const order = inp.order_no ? orders.find(o => o.orderNo.toUpperCase() === inp.order_no!.toUpperCase()) : undefined;
      const source = sourceOf(opts.channel);
      const ref = inp.external_ref ?? (inp.order_no ? `MP-${inp.order_no}` : `IN-${randomUUID().slice(0, 6)}`);

      // deduplication is the system's job, not the model's
      const dup = findDuplicate(cases, { sku: inp.sku, orderNo: inp.order_no, clientKey: order?.clientKey, serial: inp.serial, receivedAt, externalRef: inp.external_ref }, settings.dedupWindowDays);
      if (dup) {
        const c = dup.case;
        const already = (c.sources ?? []).some(s => s.ref === ref);
        if (!already) c.sources = [...(c.sources ?? []), { source, ref, at: receivedAt }];
        c.photos = (c.photos ?? 0) + (inp.photos ?? 0);
        await store.saveCase(c);
        await store.audit({ at: new Date().toISOString(), actor: 'agent', action: 'case.merged', entityId: c.id, details: { by: dup.by, source, ref } });
        recorded = c; merged = true; duplicate = true;
        return { merged_into: c.id, matched_by: dup.by, sources: c.sources?.map(s => s.source), status: c.status, note: 'Same defect already registered — added as another source, not counted twice.' };
      }

      // re-derive attribution server-side — never trust the model's batch claim
      const a = attributeCase({ batches, orders }, { sku: inp.sku, serial: inp.serial, orderNo: inp.order_no, labelBatchCode: inp.label_batch_code });
      const sup = a.batch ? suppliers.find(s => s.id === a.batch!.supplierId) : undefined;
      const inWarranty = a.batch && sup ? withinFactoryWarranty(a.batch, sup, receivedAt) : undefined;
      const claimable = a.level === 'A' || a.level === 'B';
      const cost = computeCaseCost(a.batch, { labour: inp.labour_cost, logistics: inp.logistics_cost, compensation: inp.compensation_cost });
      const d = decide({ defectClass: inp.defect_class, confidence: inp.confidence, attribution: a.method, level: a.level, hasBatch: !!a.batch, withinFactoryWarranty: inWarranty, threshold: settings.confidenceThreshold });

      const c: DefectCase = {
        id: randomUUID(),
        externalRef: ref,
        channel: opts.channel,
        receivedAt,
        sku: inp.sku,
        serial: inp.serial,
        orderNo: inp.order_no,
        clientKey: order?.clientKey,
        batchId: a.batch?.id,
        supplierId: claimable ? a.batch?.supplierId : undefined,
        candidateSupplierIds: a.level === 'C' ? a.candidateSupplierIds : undefined,
        attribution: a.method,
        level: a.level,
        description: redact(inp.description).text,
        defectClass: inp.defect_class,
        defectCode: inp.defect_code,
        confidence: inp.confidence,
        reasoning: redact(inp.reasoning).text,
        cost,
        recoverable: d.recoverable,
        needsReview: d.needsReview,
        reviewReasons: d.reviewReasons,
        status: d.status,
        sources: [{ source, ref, at: receivedAt }],
        photos: inp.photos ?? 0,
      };
      await store.saveCase(c);
      await store.audit({ at: new Date().toISOString(), actor: 'agent', action: 'case.saved', entityId: c.id, details: { level: a.level, status: c.status, total: cost.total } });
      recorded = c;
      return {
        case_id: c.id,
        level: a.level,
        why: a.why,
        batch: claimable ? a.batch?.code ?? null : null,
        factory: claimable ? sup?.code ?? null : null,
        total_cost_usd: cost.total,
        recoverable: d.recoverable,
        status: d.status,
        review_reasons: d.reviewReasons,
      };
    }

    if (name === 'request_label_photo') {
      const { case_id } = LabelIn.parse(input);
      const c = (await store.cases()).find(x => x.id === case_id);
      if (!c) throw new Error('unknown case');
      if (c.level === 'A' || c.level === 'B') return { sent: false, reason: `level ${c.level} — the batch is already known` };
      c.labelRequestedAt = new Date().toISOString();
      if (c.status === 'analytics_only' || c.status === 'awaiting_label') c.status = 'awaiting_label';
      await store.saveCase(c);
      await store.audit({ at: c.labelRequestedAt, actor: 'agent', action: 'case.label_requested', entityId: c.id });
      return {
        sent: true,
        message_ru: 'Здравствуйте! Чтобы быстрее решить вопрос, пришлите, пожалуйста, фото этикетки на изделии или коробке — там номер партии (B-2026-…) или QR-код.',
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
