/* ============================================================
 * OWED · Supplier Quality & Performance Management (SQPM)
 * Evidence registry: SKU → batch → order → factory → contract → defect → damage
 * ============================================================ */

export type DefectClass = 'manufacturing' | 'transport' | 'installation' | 'unknown';

/** How the batch was found. Mapped to an attribution level (A–D) by `levelOf`. */
export type Attribution =
  | 'serial'                 // A: serial number inside the batch's serial range
  | 'label'                  // A: batch code / QR read from the product label photo
  | 'order_stock'            // B: marketplace order ship date → batches in stock → one factory
  | 'sku_single_batch'       // B: the SKU has exactly one batch
  | 'manual'                 // B: a person set the batch after checking documents
  | 'sku_latest_batch_guess' // C: several batches/factories, a guess — analytics only
  | 'none';                  // D: nothing to go on — ask the customer for a label photo

/** A confirmed · B computed · C probable (analytics only) · D unknown (not counted). */
export type AttributionLevel = 'A' | 'B' | 'C' | 'D';

export type CaseStatus =
  | 'new' | 'needs_review' | 'evidenced' | 'claimed' | 'offered'
  | 'recovered' | 'written_off' | 'not_recoverable'
  | 'analytics_only'   // level C: counts in analytics, never in a claim
  | 'awaiting_label';  // level D: waiting for the customer's label photo

export type SignalSource = 'marketplace' | 'reclamation' | 'service_center';

/** Recurring defect families — lets the system see "the same defect in several batches". */
export type DefectCode =
  | 'cartridge_seal' | 'coating' | 'casting' | 'thread' | 'valve'
  | 'heating_element' | 'lid_hinge' | 'switch' | 'packaging' | 'other';

/* ---------------- contracts ---------------- */

export type ClauseTopic =
  | 'warranty_months'
  | 'defect_allowance_pct'
  | 'compensation_basis'
  | 'delivery_grace_days'
  | 'delivery_penalty_pct_day'
  | 'delivery_penalty_cap_pct'
  | 'claim_response_days'
  | 'evidence_standard';

/** One term of a factory contract, always tied to the clause it came from. */
export interface ContractClause {
  topic: ClauseTopic;
  ref: string;          // "7.2"
  quote: string;        // verbatim text of the clause
  value?: number;       // numeric terms
  basis?: 'all_cases' | 'excess_only';
  sku?: string;         // an allowance that applies to one SKU only
  confirmed: boolean;   // a person checked the extraction
  extractedBy: 'agent' | 'person' | 'seed';
}

export interface ContractTerms {
  warrantyMonths: number;
  allowedDefectPct: number;
  allowedDefectPctBySku: Record<string, number>;
  /** all_cases: once a batch is over the allowance every confirmed case is compensated; excess_only: only cases above it. */
  compensationBasis: 'all_cases' | 'excess_only';
  includeLogistics: boolean;
  includeService: boolean;
  deliveryGraceDays: number;
  deliveryPenaltyPctPerDay: number;
  deliveryPenaltyCapPct: number;
  claimResponseDays: number;
}

export interface Contract {
  id: string;
  supplierId: string;
  number: string;
  signedAt: string;
  text: string;
  clauses: ContractClause[];
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  city?: string;
  contactLang: 'zh' | 'en';
  /** Kept for backward compatibility; the contract terms are the source of truth. */
  warrantyMonths: number;
  allowedDefectPct: number;
  currency: string;
  contractId?: string;
}

/* ---------------- supply ---------------- */

export interface Batch {
  id: string;
  code: string;
  supplierId: string;
  sku: string;
  product?: string;
  container?: string;
  serialFrom?: number;
  serialTo?: number;
  shippedAt: string;   // left the factory
  arrivedAt?: string;  // reached our warehouse (stock window start)
  soldOutAt?: string;  // last unit left the warehouse (stock window end)
  qty: number;         // purchased
  soldUnits?: number;  // sold so far — the base for the defect rate
  unitCost: number;
  deliveryId?: string;
}

export interface Delivery {
  id: string;
  supplierId: string;
  po: string;
  amount: number;
  currency: string;
  plannedAt: string;    // contract date
  confirmedAt?: string; // date the factory confirmed
  actualAt?: string;    // arrived (undefined = still in transit)
}

export interface MarketplaceOrder {
  orderNo: string;
  sku: string;
  shippedAt: string;
  clientKey: string;    // pseudonymous customer id, never a name
}

/* ---------------- evidence ---------------- */

/** A raw message from one of the three systems, before deduplication. */
export interface Signal {
  id: string;
  source: SignalSource;
  ref: string;
  receivedAt: string;
  sku: string;
  orderNo?: string;
  clientKey?: string;
  serial?: number;
  photos: number;
  text: string;
  caseId?: string;
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
  orderNo?: string;
  clientKey?: string;
  batchId?: string;
  supplierId?: string;
  attribution: Attribution;
  level?: AttributionLevel;
  /** Candidate factories when the batch is not certain (level C). */
  candidateSupplierIds?: string[];
  description: string;
  defectClass: DefectClass;
  defectCode?: DefectCode;
  confidence: number;
  reasoning: string;
  cost: CaseCost;
  recoverable: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  status: CaseStatus;
  /** All messages merged into this case (one defect seen in MP, reclamation and SC = one case). */
  sources?: { source: SignalSource; ref: string; at: string }[];
  photos?: number;
  labelRequestedAt?: string;
  claimId?: string;
}

/* ---------------- claims ---------------- */

export interface CompensationOption {
  form: 'credit_note' | 'free_parts' | 'warranty_extension';
  value: number;
  description: string;
}

export interface BatchDefectLine {
  batchCode: string;
  sku: string;
  cases: number;
  qty: number;
  soldUnits?: number;
  pct: number;
  allowedPct: number;
  overAllowance?: boolean;
  compensatedCases?: number;
  amount?: number;
  clauseRef?: string;
}

export interface NegotiationPack {
  id: string;
  supplierId: string;
  periodFrom: string;
  periodTo: string;
  caseIds: string[];
  amount: number;
  defectPctByBatch: BatchDefectLine[];
  options: CompensationOption[];
  contractClauses: string[];
  textEn?: string;
  textZh?: string;
  status: 'draft' | 'approved' | 'sent';
}

export type ClaimStatus = 'draft' | 'reviewed' | 'sent' | 'acknowledged' | 'disputed' | 'paid' | 'legal' | 'withdrawn';

export type Role = 'buyer' | 'quality' | 'service' | 'management';

export interface DeliveryPenaltyLine {
  po: string;
  plannedAt: string;
  actualAt: string;
  daysLate: number;
  billableDays: number;
  amount: number;
  clauseRef?: string;
}

export interface Claim {
  id: string;
  number: string;
  supplierId: string;
  periodFrom: string;
  periodTo: string;
  currency: string;
  caseIds: string[];
  batches: BatchDefectLine[];
  defectAmount: number;
  deliveryPenalties: DeliveryPenaltyLine[];
  deliveryAmount: number;
  amount: number;
  directDamage: number;
  clauseRefs: { ref: string; topic: ClauseTopic; quote: string }[];
  options: CompensationOption[];
  proposedClauses: string[];
  evidence: { photos: number; reclamations: number; serviceActs: number; marketplace: number };
  letters: { ru?: string; en?: string; zh?: string; source?: 'model' | 'template' };
  status: ClaimStatus;
  createdAt: string;
  reviewedBy?: string;
  sentAt?: string;
  dueAt?: string;
  repliedAt?: string;
  paidAmount?: number;
  paidAt?: string;
  history: { at: string; status: ClaimStatus; role: Role | 'agent'; note?: string }[];
}

/* ---------------- settings ---------------- */

export interface ScoreSettings {
  weights: { quality: number; delivery: number; claims: number; response: number };
  bands: { control: number; priority: number };     // < control → control, > priority → priority
  dedupWindowDays: number;
  confidenceThreshold: number;
}

export const DEFAULT_SETTINGS: ScoreSettings = {
  weights: { quality: 35, delivery: 35, claims: 20, response: 10 },
  bands: { control: 60, priority: 80 },
  dedupWindowDays: 30,
  confidenceThreshold: 0.75,
};
