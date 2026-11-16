import type { Attribution, AttributionLevel, CaseStatus, DefectClass } from '../types';
import { levelOf } from './attribution';

export const CONFIDENCE_THRESHOLD = 0.75;

/**
 * Business rules the agent cannot override:
 *  - only a manufacturing defect, attributed at level A or B, inside the factory warranty is recoverable;
 *  - level C counts in analytics only, level D waits for the customer's label photo;
 *  - low confidence or an unknown class goes to a person first.
 */
export function decide(args: {
  defectClass: DefectClass;
  confidence: number;
  attribution: Attribution;
  hasBatch: boolean;
  withinFactoryWarranty?: boolean;
  level?: AttributionLevel;
  threshold?: number;
}): {
  recoverable: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  status: CaseStatus;
  level: AttributionLevel;
} {
  const level = args.level ?? levelOf(args.attribution);
  const reasons: string[] = [];
  const thr = args.threshold ?? CONFIDENCE_THRESHOLD;
  if (args.confidence < thr) reasons.push(`low confidence (${args.confidence.toFixed(2)})`);
  if (args.defectClass === 'unknown') reasons.push('defect class unknown');
  const inWarranty = args.withinFactoryWarranty !== false;
  if (!inWarranty) reasons.push('outside factory warranty period');

  const claimableLevel = level === 'A' || level === 'B';
  const recoverable = args.defectClass === 'manufacturing' && args.hasBatch && inWarranty && claimableLevel;
  const needsReview = reasons.length > 0 && (recoverable || args.defectClass === 'unknown');

  let status: CaseStatus;
  if (args.defectClass === 'manufacturing' && level === 'C') status = 'analytics_only';
  else if ((args.defectClass === 'manufacturing' || args.defectClass === 'unknown') && level === 'D') status = 'awaiting_label';
  else if (needsReview) status = 'needs_review';
  else if (recoverable) status = 'evidenced';
  else status = 'not_recoverable';

  if (level === 'C') reasons.push('several factories possible — analytics only');
  if (level === 'D') reasons.push('no batch — label photo requested');

  return { recoverable, needsReview: needsReview && status === "needs_review", reviewReasons: reasons, status, level };
}
