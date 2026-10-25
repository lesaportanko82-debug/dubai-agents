import type { Batch, CaseCost, CostInput } from '../types.js';

/** Defaults are per-organization settings in production; demo values here. */
export interface CostPolicy {
  partShareOfUnitCost: number; // spare part ≈ share of unit purchase cost
  defaultLabour: number;
  defaultLogistics: number;
}

export const DEFAULT_COST_POLICY: CostPolicy = {
  partShareOfUnitCost: 0.6,
  defaultLabour: 12,
  defaultLogistics: 8,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Deterministic: the model never computes money. */
export function computeCaseCost(batch: Batch | undefined, input: CostInput = {}, policy = DEFAULT_COST_POLICY): CaseCost {
  const part = batch ? r2(batch.unitCost * policy.partShareOfUnitCost) : 0;
  const labour = r2(nonNeg(input.labour) ?? policy.defaultLabour);
  const logistics = r2(nonNeg(input.logistics) ?? policy.defaultLogistics);
  const compensation = r2(nonNeg(input.compensation) ?? 0);
  return { part, labour, logistics, compensation, total: r2(part + labour + logistics + compensation) };
}

function nonNeg(n: unknown): number | undefined {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}
