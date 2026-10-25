import type { Attribution, CaseStatus, DefectClass } from '../types';

export const CONFIDENCE_THRESHOLD = 0.75;

/**
 * Business rules the agent cannot override: what is recoverable and what needs a human.
 */
export function decide(args: {
  defectClass: DefectClass;
  confidence: number;
  attribution: Attribution;
  hasBatch: boolean;
  withinFactoryWarranty?: boolean;
}): {
  recoverable: boolean;
  needsReview: boolean;
  reviewReasons: string[];
  status: CaseStatus;
} {
  const reasons: string[] = [];
  if (args.confidence < CONFIDENCE_THRESHOLD) reasons.push(`low confidence (${args.confidence.toFixed(2)})`);
  if (args.attribution === 'sku_latest_batch_guess') reasons.push('batch guessed from SKU, no serial');
  if (args.attribution === 'none') reasons.push('no batch found');
  if (args.defectClass === 'unknown') reasons.push('defect class unknown');
  const inWarranty = args.withinFactoryWarranty !== false;
  if (!inWarranty) reasons.push('outside factory warranty period');

  const recoverable = args.defectClass === 'manufacturing' && args.hasBatch && inWarranty;
  const needsReview = reasons.length > 0 && (recoverable || args.defectClass === 'unknown');

  let status: CaseStatus;
  if (needsReview) status = 'needs_review';
  else if (recoverable) status = 'evidenced';
  else status = 'not_recoverable';

  return { recoverable, needsReview, reviewReasons: reasons, status };
}
