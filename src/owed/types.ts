export type DefectClass = 'manufacturing' | 'transport' | 'installation' | 'unknown';
export type Attribution = 'serial' | 'sku_single_batch' | 'sku_latest_batch_guess' | 'none' | 'manual';
export type CaseStatus =
  | 'new' | 'needs_review' | 'evidenced' | 'claimed' | 'offered'
  | 'recovered' | 'written_off' | 'not_recoverable';

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactLang: 'zh' | 'en';
  warrantyMonths: number;
  allowedDefectPct: number;
  currency: string;
}

export interface Batch {
  id: string;
  code: string;
  supplierId: string;
  sku: string;
  container?: string;
  serialFrom?: number;
  serialTo?: number;
  shippedAt: string; // ISO date
  qty: number;
  unitCost: number;
}

export interface CostInput {
  labour?: number;
  logistics?: number;
  compensation?: number;
}

export interface CaseCost {
  part: number;
  labour: number;
  logistics: number;
  compensation: number;
  total: number;
}

export interface DefectCase {
  id: string;
  externalRef?: string;
  channel: string;
  receivedAt: string;
  sku: string;
  serial?: number;
  batchId?: string;
  supplierId?: string;
  attribution: Attribution;
  description: string;
  defectClass: DefectClass;
  confidence: number;
  reasoning: string;
  cost: CaseCost;
  recoverable: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  status: CaseStatus;
}

export interface CompensationOption {
  form: 'credit_note' | 'free_parts' | 'warranty_extension';
  value: number;
  description: string;
}

export interface NegotiationPack {
  id: string;
  supplierId: string;
  periodFrom: string;
  periodTo: string;
  caseIds: string[];
  amount: number;
  defectPctByBatch: { batchCode: string; sku: string; cases: number; qty: number; pct: number; allowedPct: number }[];
  options: CompensationOption[];
  contractClauses: string[];
  textEn?: string;
  textZh?: string;
  status: 'draft' | 'approved' | 'sent';
}
